use std::sync::Arc;
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, DbErr,
    FromQueryResult, Statement, Value as DbValue,
};
use serde_json::Value;

use crate::types::{
    FulfillmentSnapshot, OwnedCard, PendingOrder, ReleasedOrder, WalletActivityResponse,
    WebhookReceipt, epoch_millis, is_transaction_hash,
};

const BACKEND: DbBackend = DbBackend::Postgres;
const CONNECT_TIMEOUT_SECONDS: u64 = 10;
const ACQUIRE_TIMEOUT_SECONDS: u64 = 10;
const STATEMENT_TIMEOUT_SECONDS: u64 = 15;
const MAX_CONNECTIONS: u32 = 5;

#[derive(Clone)]
pub(crate) struct CardForgeStore {
    db: DatabaseConnection,
    store_key: Arc<String>,
}

impl CardForgeStore {
    pub(crate) async fn connect(database_url: &str, store_key: String) -> Result<Self, DbErr> {
        let db = connect_database(database_url).await?;
        ensure_schema(&db).await?;
        Ok(Self {
            db,
            store_key: Arc::new(store_key),
        })
    }

    pub(crate) async fn record_pending(&self, pending: PendingOrder) -> Result<(), DbErr> {
        exec(
            &self.db,
            r#"
            insert into cardforge_pending_orders (
                store_key, checkout_session_id, amount_label, amount_minor_units,
                buyer_wallet_address, chain_invoice_id, created_at, invoice_id,
                product_id, product_title
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            on conflict (store_key, checkout_session_id) do update set
                amount_label = excluded.amount_label,
                amount_minor_units = excluded.amount_minor_units,
                buyer_wallet_address = excluded.buyer_wallet_address,
                chain_invoice_id = excluded.chain_invoice_id,
                created_at = excluded.created_at,
                invoice_id = excluded.invoice_id,
                product_id = excluded.product_id,
                product_title = excluded.product_title
            "#,
            vec![
                self.store_key.as_str().into(),
                pending.checkout_session_id.into(),
                pending.amount_label.into(),
                i64_from_u64(pending.amount_minor_units, "amount_minor_units").into(),
                pending.buyer_wallet_address.into(),
                i64_from_u64(pending.chain_invoice_id, "chain_invoice_id").into(),
                pending.created_at.into(),
                pending.invoice_id.into(),
                pending.product_id.into(),
                pending.product_title.into(),
            ],
        )
        .await
    }

    pub(crate) async fn record_release(
        &self,
        release: &ReleasedOrder,
        payload: &Value,
    ) -> Result<&'static str, DbErr> {
        let cards_json = serde_json::to_string(&release.cards)
            .expect("released cards should always serialize to JSON");
        let insert = self
            .db
            .execute_raw(stmt(
                r#"
                insert into cardforge_released_orders (
                    store_key, checkout_session_id, invoice_id, amount_label, cards_json
                )
                values ($1, $2, $3, $4, $5::jsonb)
                on conflict (store_key, checkout_session_id) do nothing
                "#,
                vec![
                    self.store_key.as_str().into(),
                    release.checkout_session_id.clone().into(),
                    release.invoice_id.clone().into(),
                    release.amount_label.clone().into(),
                    cards_json.into(),
                ],
            ))
            .await?;
        self.record_owned_card(release, payload).await?;

        Ok(if insert.rows_affected() == 0 {
            "already_released"
        } else {
            "released"
        })
    }

    pub(crate) async fn record_webhook(&self, receipt: WebhookReceipt) -> Result<usize, DbErr> {
        let payload_json =
            serde_json::to_string(&receipt.payload).expect("webhook payload should serialize");
        exec(
            &self.db,
            r#"
            insert into cardforge_webhook_receipts (
                store_key, webhook_id, signature, payload_json
            )
            values ($1, $2, $3, $4::jsonb)
            "#,
            vec![
                self.store_key.as_str().into(),
                receipt.id.into(),
                receipt.signature.into(),
                payload_json.into(),
            ],
        )
        .await?;

        self.webhook_count().await
    }

    pub(crate) async fn webhooks(&self) -> Result<Vec<WebhookReceipt>, DbErr> {
        let rows = WebhookRow::find_by_statement(stmt(
            r#"
            select webhook_id, signature, payload_json::text as payload_json
            from cardforge_webhook_receipts
            where store_key = $1
            order by receipt_id asc
            "#,
            vec![self.store_key.as_str().into()],
        ))
        .all(&self.db)
        .await?;

        Ok(rows.into_iter().map(WebhookRow::into_receipt).collect())
    }

    pub(crate) async fn wallet_activity(
        &self,
        wallet_address: &str,
    ) -> Result<WalletActivityResponse, DbErr> {
        let rows = OwnedCardRow::find_by_statement(stmt(
            r#"
            select
                amount_label,
                amount_minor_units,
                cards_json::text as cards_json,
                chain_invoice_id,
                checkout_session_id,
                id,
                invoice_id,
                payment_tx_hash,
                product_id,
                purchased_at,
                title,
                wallet_address
            from cardforge_owned_cards
            where store_key = $1 and lower(wallet_address) = lower($2)
            order by recorded_at desc, checkout_session_id desc
            "#,
            vec![self.store_key.as_str().into(), wallet_address.into()],
        ))
        .all(&self.db)
        .await?;
        let owned_cards = rows
            .into_iter()
            .map(OwnedCardRow::into_owned_card)
            .collect::<Vec<_>>();
        let payments = owned_cards
            .iter()
            .filter_map(OwnedCard::payment_record)
            .collect();

        Ok(WalletActivityResponse {
            owned_cards,
            payments,
        })
    }

    pub(crate) async fn fulfillment_snapshot(&self) -> Result<FulfillmentSnapshot, DbErr> {
        let latest_release = ReleasedOrderRow::find_by_statement(stmt(
            r#"
            select
                checkout_session_id,
                invoice_id,
                amount_label,
                cards_json::text as cards_json
            from cardforge_released_orders
            where store_key = $1
            order by release_id desc
            limit 1
            "#,
            vec![self.store_key.as_str().into()],
        ))
        .one(&self.db)
        .await?
        .map(ReleasedOrderRow::into_released_order);
        let released_count = self.released_count().await?;

        Ok(FulfillmentSnapshot {
            cards: latest_release
                .as_ref()
                .map(|release| release.cards.clone())
                .unwrap_or_default(),
            latest_release,
            released: released_count > 0,
            released_count,
        })
    }

    async fn record_owned_card(
        &self,
        release: &ReleasedOrder,
        payload: &Value,
    ) -> Result<(), DbErr> {
        let Some(order) = self.pending_order(&release.checkout_session_id).await? else {
            return Ok(());
        };
        let Some(wallet_address) = order.buyer_wallet_address else {
            return Ok(());
        };

        let owned = OwnedCard {
            amount_label: release
                .amount_label
                .clone()
                .unwrap_or_else(|| order.amount_label.clone()),
            amount_minor_units: order.amount_minor_units,
            cards: release.cards.clone(),
            chain_invoice_id: order.chain_invoice_id,
            checkout_session_id: release.checkout_session_id.clone(),
            id: format!("card-{}", release.checkout_session_id),
            invoice_id: release.invoice_id.clone(),
            payment_tx_hash: payload
                .get("paymentTxHash")
                .and_then(Value::as_str)
                .filter(|value| is_transaction_hash(value))
                .map(str::to_string),
            product_id: order.product_id,
            purchased_at: payload
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(epoch_millis),
            title: order.product_title,
            wallet_address,
        };
        let cards_json =
            serde_json::to_string(&owned.cards).expect("owned cards should serialize to JSON");

        exec(
            &self.db,
            r#"
            insert into cardforge_owned_cards (
                store_key, checkout_session_id, id, invoice_id, product_id, title,
                amount_label, amount_minor_units, cards_json, chain_invoice_id,
                payment_tx_hash, purchased_at, wallet_address
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
            on conflict (store_key, checkout_session_id) do update set
                id = excluded.id,
                invoice_id = excluded.invoice_id,
                product_id = excluded.product_id,
                title = excluded.title,
                amount_label = excluded.amount_label,
                amount_minor_units = excluded.amount_minor_units,
                cards_json = excluded.cards_json,
                chain_invoice_id = excluded.chain_invoice_id,
                payment_tx_hash = excluded.payment_tx_hash,
                purchased_at = excluded.purchased_at,
                wallet_address = excluded.wallet_address,
                recorded_at = now()
            "#,
            vec![
                self.store_key.as_str().into(),
                owned.checkout_session_id.into(),
                owned.id.into(),
                owned.invoice_id.into(),
                owned.product_id.into(),
                owned.title.into(),
                owned.amount_label.into(),
                i64_from_u64(owned.amount_minor_units, "amount_minor_units").into(),
                cards_json.into(),
                i64_from_u64(owned.chain_invoice_id, "chain_invoice_id").into(),
                owned.payment_tx_hash.into(),
                owned.purchased_at.into(),
                owned.wallet_address.into(),
            ],
        )
        .await
    }

    async fn pending_order(
        &self,
        checkout_session_id: &str,
    ) -> Result<Option<PendingOrder>, DbErr> {
        PendingOrderRow::find_by_statement(stmt(
            r#"
            select
                amount_label,
                amount_minor_units,
                buyer_wallet_address,
                chain_invoice_id,
                checkout_session_id,
                created_at,
                invoice_id,
                product_id,
                product_title
            from cardforge_pending_orders
            where store_key = $1 and checkout_session_id = $2
            "#,
            vec![self.store_key.as_str().into(), checkout_session_id.into()],
        ))
        .one(&self.db)
        .await
        .map(|row| row.map(PendingOrderRow::into_pending_order))
    }

    async fn webhook_count(&self) -> Result<usize, DbErr> {
        CountRow::find_by_statement(stmt(
            "select count(*)::bigint as count from cardforge_webhook_receipts where store_key = $1",
            vec![self.store_key.as_str().into()],
        ))
        .one(&self.db)
        .await
        .map(|row| row.map_or(0, |row| usize_from_i64(row.count, "webhook count")))
    }

    async fn released_count(&self) -> Result<usize, DbErr> {
        CountRow::find_by_statement(stmt(
            "select count(*)::bigint as count from cardforge_released_orders where store_key = $1",
            vec![self.store_key.as_str().into()],
        ))
        .one(&self.db)
        .await
        .map(|row| row.map_or(0, |row| usize_from_i64(row.count, "release count")))
    }
}

async fn connect_database(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    let mut options = ConnectOptions::new(database_url.to_string());
    options
        .max_connections(MAX_CONNECTIONS)
        .min_connections(0)
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
        .acquire_timeout(Duration::from_secs(ACQUIRE_TIMEOUT_SECONDS))
        .statement_timeout(Duration::from_secs(STATEMENT_TIMEOUT_SECONDS))
        .sqlx_logging(false)
        .set_application_name("cardforge-backend");

    Database::connect(options).await
}

#[derive(FromQueryResult)]
struct CountRow {
    count: i64,
}

#[derive(FromQueryResult)]
struct PendingOrderRow {
    amount_label: String,
    amount_minor_units: i64,
    buyer_wallet_address: Option<String>,
    chain_invoice_id: i64,
    checkout_session_id: String,
    created_at: String,
    invoice_id: String,
    product_id: String,
    product_title: String,
}

impl PendingOrderRow {
    fn into_pending_order(self) -> PendingOrder {
        PendingOrder {
            amount_label: self.amount_label,
            amount_minor_units: u64_from_i64(self.amount_minor_units, "amount_minor_units"),
            buyer_wallet_address: self.buyer_wallet_address,
            chain_invoice_id: u64_from_i64(self.chain_invoice_id, "chain_invoice_id"),
            checkout_session_id: self.checkout_session_id,
            created_at: self.created_at,
            invoice_id: self.invoice_id,
            product_id: self.product_id,
            product_title: self.product_title,
        }
    }
}

#[derive(FromQueryResult)]
struct OwnedCardRow {
    amount_label: String,
    amount_minor_units: i64,
    cards_json: String,
    chain_invoice_id: i64,
    checkout_session_id: String,
    id: String,
    invoice_id: String,
    payment_tx_hash: Option<String>,
    product_id: String,
    purchased_at: String,
    title: String,
    wallet_address: String,
}

impl OwnedCardRow {
    fn into_owned_card(self) -> OwnedCard {
        OwnedCard {
            amount_label: self.amount_label,
            amount_minor_units: u64_from_i64(self.amount_minor_units, "amount_minor_units"),
            cards: serde_json::from_str(&self.cards_json).unwrap_or_default(),
            chain_invoice_id: u64_from_i64(self.chain_invoice_id, "chain_invoice_id"),
            checkout_session_id: self.checkout_session_id,
            id: self.id,
            invoice_id: self.invoice_id,
            payment_tx_hash: self.payment_tx_hash,
            product_id: self.product_id,
            purchased_at: self.purchased_at,
            title: self.title,
            wallet_address: self.wallet_address,
        }
    }
}

#[derive(FromQueryResult)]
struct ReleasedOrderRow {
    amount_label: Option<String>,
    cards_json: String,
    checkout_session_id: String,
    invoice_id: String,
}

impl ReleasedOrderRow {
    fn into_released_order(self) -> ReleasedOrder {
        ReleasedOrder {
            amount_label: self.amount_label,
            cards: serde_json::from_str(&self.cards_json).unwrap_or_default(),
            checkout_session_id: self.checkout_session_id,
            invoice_id: self.invoice_id,
        }
    }
}

#[derive(FromQueryResult)]
struct WebhookRow {
    payload_json: String,
    signature: Option<String>,
    webhook_id: Option<String>,
}

impl WebhookRow {
    fn into_receipt(self) -> WebhookReceipt {
        WebhookReceipt {
            id: self.webhook_id,
            signature: self.signature,
            payload: serde_json::from_str(&self.payload_json).unwrap_or(Value::Null),
        }
    }
}

async fn ensure_schema<C>(connection: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    for sql in SCHEMA_SQL {
        connection
            .execute_raw(Statement::from_string(BACKEND, *sql))
            .await?;
    }
    Ok(())
}

static SCHEMA_SQL: &[&str] = &[
    r#"
    create table if not exists cardforge_pending_orders (
        store_key text not null,
        checkout_session_id text not null,
        amount_label text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        buyer_wallet_address text,
        chain_invoice_id bigint not null check (chain_invoice_id >= 0),
        created_at text not null,
        invoice_id text not null,
        product_id text not null,
        product_title text not null,
        primary key (store_key, checkout_session_id)
    )
    "#,
    "create index if not exists cardforge_pending_orders_wallet_idx on cardforge_pending_orders (store_key, lower(buyer_wallet_address)) where buyer_wallet_address is not null",
    r#"
    create table if not exists cardforge_released_orders (
        release_id bigserial primary key,
        store_key text not null,
        checkout_session_id text not null,
        invoice_id text not null,
        amount_label text,
        cards_json jsonb not null,
        released_at timestamptz not null default now(),
        unique (store_key, checkout_session_id)
    )
    "#,
    "create index if not exists cardforge_released_orders_store_idx on cardforge_released_orders (store_key, release_id desc)",
    r#"
    create table if not exists cardforge_owned_cards (
        store_key text not null,
        checkout_session_id text not null,
        id text not null,
        invoice_id text not null,
        product_id text not null,
        title text not null,
        amount_label text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        cards_json jsonb not null,
        chain_invoice_id bigint not null check (chain_invoice_id >= 0),
        payment_tx_hash text,
        purchased_at text not null,
        wallet_address text not null,
        recorded_at timestamptz not null default now(),
        primary key (store_key, checkout_session_id)
    )
    "#,
    "create index if not exists cardforge_owned_cards_wallet_idx on cardforge_owned_cards (store_key, lower(wallet_address), recorded_at desc)",
    r#"
    create table if not exists cardforge_webhook_receipts (
        receipt_id bigserial primary key,
        store_key text not null,
        webhook_id text,
        signature text,
        payload_json jsonb not null,
        received_at timestamptz not null default now()
    )
    "#,
    "create index if not exists cardforge_webhook_receipts_store_idx on cardforge_webhook_receipts (store_key, receipt_id asc)",
];

async fn exec(db: &DatabaseConnection, sql: &str, values: Vec<DbValue>) -> Result<(), DbErr> {
    db.execute_raw(stmt(sql, values)).await.map(|_| ())
}

fn stmt(sql: &str, values: Vec<DbValue>) -> Statement {
    Statement::from_sql_and_values(BACKEND, sql, values)
}

fn i64_from_u64(value: u64, field: &str) -> i64 {
    i64::try_from(value).unwrap_or_else(|_| panic!("{field} does not fit in postgres bigint"))
}

fn u64_from_i64(value: i64, field: &str) -> u64 {
    u64::try_from(value).unwrap_or_else(|_| panic!("{field} must be non-negative"))
}

fn usize_from_i64(value: i64, field: &str) -> usize {
    usize::try_from(value).unwrap_or_else(|_| panic!("{field} must be non-negative"))
}
