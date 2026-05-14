use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DatabaseTransaction, DbBackend,
    DbErr, FromQueryResult, Statement, TransactionTrait, Value,
};
use shared::{
    BillingPaymentRecord, BillingSubscription, CheckoutSession, EvmChain, EvmChainToken,
    EvmIndexerCursor, EvmPaymentIntent, EvmRpcNode, EvmSettlementContract,
    EvmSettlementLedgerEntry, InvoiceRecord, PaymentProject, PaymentProjectEnvironment,
    PaymentRail, ProjectInvoiceAuthority, ProjectPaymentRailSetting, ProjectWebhookEndpoint,
    ProjectWithdrawalRecord, WebhookDeliveryAttemptRecord, WebhookDeliveryRecord,
    WebhookEndpointSecretRecord, WebhookEventRecord,
};

use super::dto::{
    ApiKeyRow, AuthorityRow, BillingPaymentRow, CheckoutMetadataRow, CheckoutRow, CounterRow,
    EnvironmentRow, EvmChainRow, EvmChainTokenRow, EvmIndexerCursorRow, EvmPaymentIntentRow,
    EvmRpcNodeRow, EvmSettlementContractRow, EvmSettlementLedgerRow, IdempotencyRow, InvoiceRow,
    PaymentRailSettingRow, PortalRecordSet, ProjectRow, SubscriptionRow, WebhookDeliveryAttemptRow,
    WebhookDeliveryRow, WebhookEndpointRow, WebhookEndpointSecretRow, WebhookEventRow,
    WithdrawalRow, encode_enum, i32_from_u8, i32_from_u16, i32_from_u32, i64_from_u64, owner_key,
};
use super::schema;

const BACKEND: DbBackend = DbBackend::Postgres;
const CONNECT_TIMEOUT_SECONDS: u64 = 10;
const ACQUIRE_TIMEOUT_SECONDS: u64 = 10;
const STATEMENT_TIMEOUT_SECONDS: u64 = 15;
const MAX_CONNECTIONS: u32 = 5;
const WRITE_RETRY_ATTEMPTS: u8 = 3;
const WRITE_RETRY_DELAY_MS: u64 = 250;

pub(crate) async fn open_portal_database(database_url: &str) -> DatabaseConnection {
    connect_database(database_url)
        .await
        .unwrap_or_else(|err| panic!("connect normalized portal postgres state: {err}"))
}

pub(crate) async fn load_portal_records_from(
    db: &DatabaseConnection,
    state_key: &str,
) -> PortalRecordSet {
    schema::ensure_schema(&db)
        .await
        .unwrap_or_else(|err| panic!("load normalized portal postgres state: {err}"));
    if !normalized_state_exists(&db, state_key)
        .await
        .unwrap_or_else(|err| panic!("load normalized portal postgres state: {err}"))
    {
        replace_portal_rows(&db, state_key, &PortalRecordSet::default())
            .await
            .unwrap_or_else(|err| panic!("load normalized portal postgres state: {err}"));
    }
    read_portal_rows(&db, state_key)
        .await
        .unwrap_or_else(|err| panic!("load normalized portal postgres state: {err}"))
}

pub(crate) async fn save_portal_records_to(
    db: &DatabaseConnection,
    state_key: &str,
    records: &PortalRecordSet,
) {
    for attempt in 1..=WRITE_RETRY_ATTEMPTS {
        match replace_portal_rows(db, state_key, records).await {
            Ok(()) => return,
            Err(err) if attempt < WRITE_RETRY_ATTEMPTS => {
                log_retry("save normalized portal postgres state", attempt, &err);
                tokio::time::sleep(Duration::from_millis(WRITE_RETRY_DELAY_MS)).await;
            }
            Err(err) => {
                log_persist_failure("save normalized portal postgres state", &err);
                return;
            }
        }
    }
}

pub(crate) async fn save_payment_project_bundle_to(
    db: &DatabaseConnection,
    state_key: &str,
    project: &PaymentProject,
    payment_rails: &[ProjectPaymentRailSetting],
    environment: &PaymentProjectEnvironment,
    authority: &ProjectInvoiceAuthority,
    webhook_endpoint: Option<&ProjectWebhookEndpoint>,
    webhook_secret: Option<&WebhookEndpointSecretRecord>,
) {
    for attempt in 1..=WRITE_RETRY_ATTEMPTS {
        let result = async {
            let tx = db.begin().await?;
            insert_projects(&tx, state_key, std::iter::once(project)).await?;
            insert_project_payment_rails(&tx, state_key, payment_rails.iter()).await?;
            insert_environments(&tx, state_key, std::iter::once(environment)).await?;
            insert_authorities(&tx, state_key, std::iter::once(authority)).await?;
            if let Some(webhook_endpoint) = webhook_endpoint {
                insert_webhook_endpoints(&tx, state_key, std::iter::once(webhook_endpoint)).await?;
            }
            if let Some(webhook_secret) = webhook_secret {
                insert_webhook_endpoint_secrets(&tx, state_key, std::iter::once(webhook_secret))
                    .await?;
            }
            tx.commit().await
        }
        .await;

        match result {
            Ok(()) => return,
            Err(err) if attempt < WRITE_RETRY_ATTEMPTS => {
                log_retry("save payment project postgres rows", attempt, &err);
                tokio::time::sleep(Duration::from_millis(WRITE_RETRY_DELAY_MS)).await;
            }
            Err(err) => {
                log_persist_failure("save payment project postgres rows", &err);
                return;
            }
        }
    }
}

pub(crate) async fn save_project_api_key_to(
    db: &DatabaseConnection,
    state_key: &str,
    api_key: &crate::project_support::StoredProjectApiKey,
) {
    for attempt in 1..=WRITE_RETRY_ATTEMPTS {
        let result = async {
            let tx = db.begin().await?;
            insert_api_keys(&tx, state_key, std::iter::once(api_key)).await?;
            tx.commit().await
        }
        .await;

        match result {
            Ok(()) => return,
            Err(err) if attempt < WRITE_RETRY_ATTEMPTS => {
                log_retry("save project api key postgres row", attempt, &err);
                tokio::time::sleep(Duration::from_millis(WRITE_RETRY_DELAY_MS)).await;
            }
            Err(err) => {
                log_persist_failure("save project api key postgres row", &err);
                return;
            }
        }
    }
}

fn log_retry(context: &str, attempt: u8, err: &DbErr) {
    eprintln!(
        "{context}: postgres write failed on attempt {attempt}/{WRITE_RETRY_ATTEMPTS}; retrying: {err}"
    );
}

fn log_persist_failure(context: &str, err: &DbErr) {
    eprintln!("{context}: postgres write failed after retries; keeping in-memory state: {err}");
}

pub(crate) async fn save_billing_subscription_to(
    db: &DatabaseConnection,
    state_key: &str,
    subscription: &BillingSubscription,
) {
    save_billing_projection_to(db, state_key, subscription, None).await;
}

pub(crate) async fn save_billing_projection_to(
    db: &DatabaseConnection,
    state_key: &str,
    subscription: &BillingSubscription,
    payment: Option<&BillingPaymentRecord>,
) {
    for attempt in 1..=WRITE_RETRY_ATTEMPTS {
        let result = async {
            let tx = db.begin().await?;
            exec(
                &tx,
                r#"
                delete from zamapay_billing_subscriptions
                where state_key = $1 and owner_wallet_key = $2
                "#,
                vec![
                    state_key.into(),
                    owner_key(&subscription.owner_wallet).into(),
                ],
            )
            .await?;
            insert_subscriptions(&tx, state_key, std::iter::once(subscription)).await?;
            if let Some(payment) = payment {
                let mut histories = HashMap::new();
                histories.insert(owner_key(&payment.owner_wallet), vec![payment.clone()]);
                insert_billing_payments(&tx, state_key, &histories).await?;
            }
            tx.commit().await
        }
        .await;

        match result {
            Ok(()) => return,
            Err(err) if attempt < WRITE_RETRY_ATTEMPTS => {
                log_retry("save billing projection postgres rows", attempt, &err);
                tokio::time::sleep(Duration::from_millis(WRITE_RETRY_DELAY_MS)).await;
            }
            Err(err) => {
                log_persist_failure("save billing projection postgres rows", &err);
                return;
            }
        }
    }
}

async fn connect_database(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    let mut options = ConnectOptions::new(database_url.to_string());
    options
        .max_connections(MAX_CONNECTIONS)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
        .acquire_timeout(Duration::from_secs(ACQUIRE_TIMEOUT_SECONDS))
        .statement_timeout(Duration::from_secs(STATEMENT_TIMEOUT_SECONDS))
        .test_before_acquire(false)
        .sqlx_logging(false)
        .set_application_name("zamapay-api");

    Database::connect(options).await
}

async fn normalized_state_exists(db: &DatabaseConnection, state_key: &str) -> Result<bool, DbErr> {
    #[derive(Debug, FromQueryResult)]
    struct CountRow {
        count: i64,
    }

    let row = CountRow::find_by_statement(stmt(
        "select count(*)::bigint as count from zamapay_portal_counters where state_key = $1",
        vec![state_key.into()],
    ))
    .one(db)
    .await?;
    Ok(row.is_some_and(|row| row.count > 0))
}

async fn read_portal_rows(
    db: &DatabaseConnection,
    state_key: &str,
) -> Result<PortalRecordSet, DbErr> {
    let (
        counters,
        project_rows,
        payment_rail_rows,
        environment_rows,
        authority_rows,
        api_key_rows,
        endpoint_rows,
        endpoint_secret_rows,
        subscription_rows,
        billing_payment_rows,
        invoice_rows,
    ) = tokio::try_join!(
        async {
            CounterRow::find_by_statement(stmt(
                r#"
                select next_invoice_number
                from zamapay_portal_counters
                where state_key = $1
                "#,
                vec![state_key.into()],
            ))
            .one(db)
            .await
        },
        select::<ProjectRow>(
            db,
            "select * from zamapay_payment_projects where state_key = $1",
            state_key,
        ),
        select::<PaymentRailSettingRow>(
            db,
            "select * from zamapay_project_payment_rails where state_key = $1",
            state_key,
        ),
        select::<EnvironmentRow>(
            db,
            "select * from zamapay_project_environments where state_key = $1",
            state_key,
        ),
        select::<AuthorityRow>(
            db,
            "select * from zamapay_invoice_authorities where state_key = $1",
            state_key,
        ),
        select::<ApiKeyRow>(
            db,
            "select * from zamapay_project_api_keys where state_key = $1",
            state_key,
        ),
        select::<WebhookEndpointRow>(
            db,
            "select * from zamapay_webhook_endpoints where state_key = $1",
            state_key,
        ),
        select::<WebhookEndpointSecretRow>(
            db,
            "select * from zamapay_webhook_endpoint_secrets where state_key = $1",
            state_key,
        ),
        select::<SubscriptionRow>(
            db,
            "select * from zamapay_billing_subscriptions where state_key = $1",
            state_key,
        ),
        select::<BillingPaymentRow>(
            db,
            "select * from zamapay_billing_payments where state_key = $1",
            state_key,
        ),
        select::<InvoiceRow>(
            db,
            "select * from zamapay_invoices where state_key = $1",
            state_key,
        ),
    )?;

    let (
        checkout_metadata,
        checkout_rows,
        idempotency_rows,
        event_rows,
        delivery_rows,
        attempt_rows,
        withdrawal_rows,
    ) = tokio::try_join!(
        checkout_metadata_by_session(db, state_key),
        select::<CheckoutRow>(
            db,
            "select * from zamapay_checkout_sessions where state_key = $1",
            state_key,
        ),
        select::<IdempotencyRow>(
            db,
            "select * from zamapay_checkout_idempotency where state_key = $1",
            state_key,
        ),
        select::<WebhookEventRow>(
            db,
            "select * from zamapay_webhook_events where state_key = $1",
            state_key,
        ),
        select::<WebhookDeliveryRow>(
            db,
            "select * from zamapay_webhook_deliveries where state_key = $1",
            state_key,
        ),
        select::<WebhookDeliveryAttemptRow>(
            db,
            "select * from zamapay_webhook_delivery_attempts where state_key = $1",
            state_key,
        ),
        select::<WithdrawalRow>(
            db,
            "select * from zamapay_project_withdrawals where state_key = $1",
            state_key,
        ),
    )?;

    let counters = counters.expect("portal counters should exist after schema initialization");
    let mut records = PortalRecordSet {
        next_invoice_number: u64::try_from(counters.next_invoice_number)
            .expect("next invoice number should be positive"),
        ..PortalRecordSet::default()
    };

    for row in project_rows {
        let project = row.into_domain();
        records.projects.insert(project.project_id.clone(), project);
    }
    for row in payment_rail_rows {
        let setting = row.into_domain();
        records.payment_rail_settings.insert(
            payment_rail_setting_key(&setting.project_id, setting.payment_rail),
            setting,
        );
    }
    for row in environment_rows {
        let environment = row.into_domain();
        records
            .environments
            .insert(environment.environment_id.clone(), environment);
    }
    for row in authority_rows {
        let authority = row.into_domain();
        records
            .invoice_authorities
            .insert(authority.authority_id.clone(), authority);
    }
    for row in api_key_rows {
        let key = row.into_domain();
        records.api_keys.insert(key.record.key_id.clone(), key);
    }
    for row in endpoint_rows {
        let endpoint = row.into_domain();
        records
            .webhook_endpoints
            .insert(endpoint.endpoint_id.clone(), endpoint);
    }
    for row in endpoint_secret_rows {
        let secret = row.into_domain();
        records
            .webhook_endpoint_secrets
            .insert(secret.secret_id.clone(), secret);
    }
    for row in subscription_rows {
        let (key, subscription) = row.into_domain();
        records.subscriptions.insert(key, subscription);
    }
    for row in billing_payment_rows {
        let (key, payment) = row.into_domain();
        records
            .billing_payments
            .entry(key)
            .or_default()
            .push(payment);
    }
    for row in invoice_rows {
        let invoice = row.into_domain();
        records.invoices.insert(invoice.invoice_id.clone(), invoice);
    }

    let (
        evm_chain_rows,
        evm_token_rows,
        evm_rpc_rows,
        evm_settlement_contract_rows,
        evm_intent_rows,
        evm_settlement_event_rows,
        evm_cursor_rows,
    ) = tokio::try_join!(
        select::<EvmChainRow>(
            db,
            "select * from zamapay_evm_chains where state_key = $1",
            state_key,
        ),
        select::<EvmChainTokenRow>(
            db,
            "select * from zamapay_evm_chain_tokens where state_key = $1",
            state_key,
        ),
        select::<EvmRpcNodeRow>(
            db,
            "select * from zamapay_evm_rpc_nodes where state_key = $1",
            state_key,
        ),
        select::<EvmSettlementContractRow>(
            db,
            "select * from zamapay_evm_settlement_contracts where state_key = $1",
            state_key,
        ),
        select::<EvmPaymentIntentRow>(
            db,
            "select * from zamapay_evm_payment_intents where state_key = $1",
            state_key,
        ),
        select::<EvmSettlementLedgerRow>(
            db,
            "select * from zamapay_evm_settlement_ledger where state_key = $1",
            state_key,
        ),
        select::<EvmIndexerCursorRow>(
            db,
            "select * from zamapay_evm_indexer_cursors where state_key = $1",
            state_key,
        ),
    )?;

    for row in evm_chain_rows {
        let chain = row.into_domain();
        records.evm_chains.insert(chain.chain_id, chain);
    }
    for row in evm_token_rows {
        let token = row.into_domain();
        records
            .evm_chain_tokens
            .insert(token.token_id.clone(), token);
    }
    for row in evm_rpc_rows {
        let rpc_node = row.into_domain();
        records
            .evm_rpc_nodes
            .insert(rpc_node.rpc_node_id.clone(), rpc_node);
    }
    for row in evm_settlement_contract_rows {
        let settlement_contract = row.into_domain();
        records.evm_settlement_contracts.insert(
            settlement_contract.settlement_contract_id.clone(),
            settlement_contract,
        );
    }
    for row in evm_intent_rows {
        let intent = row.into_domain();
        records
            .evm_payment_intents
            .insert(intent.intent_id.clone(), intent);
    }
    for row in evm_settlement_event_rows {
        let settlement_event = row.into_domain();
        records.evm_settlement_ledger.insert(
            settlement_event.settlement_event_id.clone(),
            settlement_event,
        );
    }
    for row in evm_cursor_rows {
        let cursor = row.into_domain();
        records
            .evm_indexer_cursors
            .insert(cursor.cursor_id.clone(), cursor);
    }

    for row in checkout_rows {
        let session_id = row.checkout_session_id.clone();
        let session = row.into_domain(
            checkout_metadata
                .get(&session_id)
                .cloned()
                .unwrap_or_default(),
        );
        records
            .checkout_sessions
            .insert(session.checkout_session_id.clone(), session);
    }
    for row in idempotency_rows {
        records
            .idempotency_keys
            .insert(row.scope, row.checkout_session_id);
    }
    for row in event_rows {
        let event = row.into_domain();
        records.webhook_events.insert(event.event_id.clone(), event);
    }
    for row in delivery_rows {
        let delivery = row.into_domain();
        records
            .webhook_deliveries
            .insert(delivery.delivery_id.clone(), delivery);
    }
    for row in attempt_rows {
        let attempt = row.into_domain();
        records
            .webhook_delivery_attempts
            .insert(attempt.attempt_id.clone(), attempt);
    }
    for row in withdrawal_rows {
        let withdrawal = row.into_domain();
        records
            .project_withdrawals
            .insert(withdrawal.withdrawal_id.clone(), withdrawal);
    }

    Ok(records)
}

async fn checkout_metadata_by_session(
    db: &DatabaseConnection,
    state_key: &str,
) -> Result<HashMap<String, BTreeMap<String, String>>, DbErr> {
    let mut metadata = HashMap::<String, BTreeMap<String, String>>::new();
    for row in select::<CheckoutMetadataRow>(
        db,
        "select * from zamapay_checkout_metadata where state_key = $1",
        state_key,
    )
    .await?
    {
        metadata
            .entry(row.checkout_session_id)
            .or_default()
            .insert(row.metadata_key, row.metadata_value);
    }
    Ok(metadata)
}

async fn replace_portal_rows(
    db: &DatabaseConnection,
    state_key: &str,
    records: &PortalRecordSet,
) -> Result<(), DbErr> {
    let tx = db.begin().await?;
    exec(
        &tx,
        "delete from zamapay_portal_counters where state_key = $1",
        vec![state_key.into()],
    )
    .await?;
    insert_counters(&tx, state_key, records).await?;
    insert_projects(&tx, state_key, records.projects.values()).await?;
    insert_project_payment_rails(&tx, state_key, records.payment_rail_settings.values()).await?;
    insert_environments(&tx, state_key, records.environments.values()).await?;
    insert_authorities(&tx, state_key, records.invoice_authorities.values()).await?;
    insert_api_keys(&tx, state_key, records.api_keys.values()).await?;
    insert_webhook_endpoints(&tx, state_key, records.webhook_endpoints.values()).await?;
    insert_webhook_endpoint_secrets(&tx, state_key, records.webhook_endpoint_secrets.values())
        .await?;
    insert_subscriptions(&tx, state_key, records.subscriptions.values()).await?;
    insert_billing_payments(&tx, state_key, &records.billing_payments).await?;
    insert_evm_chains(&tx, state_key, records.evm_chains.values()).await?;
    insert_evm_chain_tokens(&tx, state_key, records.evm_chain_tokens.values()).await?;
    insert_evm_rpc_nodes(&tx, state_key, records.evm_rpc_nodes.values()).await?;
    insert_evm_settlement_contracts(&tx, state_key, records.evm_settlement_contracts.values())
        .await?;
    insert_evm_payment_intents(&tx, state_key, records.evm_payment_intents.values()).await?;
    insert_evm_settlement_ledger(&tx, state_key, records.evm_settlement_ledger.values()).await?;
    insert_evm_indexer_cursors(&tx, state_key, records.evm_indexer_cursors.values()).await?;
    insert_invoices(&tx, state_key, records.invoices.values()).await?;
    insert_checkout_sessions(&tx, state_key, records.checkout_sessions.values()).await?;
    insert_idempotency(&tx, state_key, &records.idempotency_keys).await?;
    insert_webhook_events(&tx, state_key, records.webhook_events.values()).await?;
    insert_webhook_deliveries(&tx, state_key, records.webhook_deliveries.values()).await?;
    insert_webhook_delivery_attempts(&tx, state_key, records.webhook_delivery_attempts.values())
        .await?;
    insert_withdrawals(&tx, state_key, records.project_withdrawals.values()).await?;
    tx.commit().await
}

async fn insert_counters(
    tx: &DatabaseTransaction,
    state_key: &str,
    records: &PortalRecordSet,
) -> Result<(), DbErr> {
    exec(
        tx,
        r#"
        insert into zamapay_portal_counters
            (state_key, next_invoice_number, updated_at)
        values ($1, $2, now())
        "#,
        vec![
            state_key.into(),
            i64_from_u64(records.next_invoice_number, "counter.next_invoice_number").into(),
        ],
    )
    .await
}

async fn insert_projects<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    projects: impl Iterator<Item = &'a PaymentProject>,
) -> Result<(), DbErr> {
    for project in projects {
        exec(tx, r#"
            insert into zamapay_payment_projects
                (state_key, project_id, name, owner_wallet, default_environment, billing_plan, status, created_at, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), project.project_id.clone().into(), project.name.clone().into(),
                project.owner_wallet.clone().into(), encode_enum(&project.default_environment).into(),
                encode_enum(&project.billing_plan).into(), encode_enum(&project.status).into(),
                project.created_at.into(), project.updated_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_project_payment_rails<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    payment_rails: impl Iterator<Item = &'a ProjectPaymentRailSetting>,
) -> Result<(), DbErr> {
    for setting in payment_rails {
        exec(
            tx,
            r#"
            insert into zamapay_project_payment_rails
                (state_key, project_id, payment_rail, enabled, created_at, updated_at)
            values ($1,$2,$3,$4,$5,$6)
            "#,
            vec![
                state_key.into(),
                setting.project_id.clone().into(),
                encode_enum(&setting.payment_rail).into(),
                setting.enabled.into(),
                setting.created_at.into(),
                setting.updated_at.into(),
            ],
        )
        .await?;
    }
    Ok(())
}

async fn insert_environments<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    environments: impl Iterator<Item = &'a PaymentProjectEnvironment>,
) -> Result<(), DbErr> {
    for environment in environments {
        exec(tx, r#"
            insert into zamapay_project_environments
                (state_key, environment_id, project_id, environment, chain_id, settlement_contract, token_contract, invoice_authority_id, status)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), environment.environment_id.clone().into(), environment.project_id.clone().into(),
                encode_enum(&environment.environment).into(),
                environment.chain_id.map(|value| i64_from_u64(value, "environment.chain_id")).into(),
                environment.settlement_contract.clone().into(), environment.token_contract.clone().into(),
                environment.invoice_authority_id.clone().into(), encode_enum(&environment.status).into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_authorities<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    authorities: impl Iterator<Item = &'a ProjectInvoiceAuthority>,
) -> Result<(), DbErr> {
    for authority in authorities {
        exec(tx, r#"
            insert into zamapay_invoice_authorities
                (state_key, authority_id, project_id, environment, mode, signer_address, key_ref, merchant_registered, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), authority.authority_id.clone().into(), authority.project_id.clone().into(),
                encode_enum(&authority.environment).into(), encode_enum(&authority.mode).into(),
                authority.signer_address.clone().into(), authority.key_ref.clone().into(),
                authority.merchant_registered.into(), authority.created_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_api_keys<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    api_keys: impl Iterator<Item = &'a crate::project_support::StoredProjectApiKey>,
) -> Result<(), DbErr> {
    for key in api_keys {
        exec(tx, r#"
            insert into zamapay_project_api_keys
                (state_key, key_id, project_id, environment, label, prefix, secret_hash, created_at, last_used_at, revoked_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            "#, vec![
                state_key.into(), key.record.key_id.clone().into(), key.record.project_id.clone().into(),
                encode_enum(&key.record.environment).into(), key.record.label.clone().into(),
                key.record.prefix.clone().into(), key.secret_hash.clone().into(), key.record.created_at.into(),
                key.record.last_used_at.into(), key.record.revoked_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_webhook_endpoints<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    endpoints: impl Iterator<Item = &'a ProjectWebhookEndpoint>,
) -> Result<(), DbErr> {
    for endpoint in endpoints {
        exec(tx, r#"
            insert into zamapay_webhook_endpoints
                (state_key, endpoint_id, project_id, environment, url, enabled, secret_preview, created_at, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), endpoint.endpoint_id.clone().into(), endpoint.project_id.clone().into(),
                encode_enum(&endpoint.environment).into(), endpoint.url.clone().into(), endpoint.enabled.into(),
                endpoint.secret_preview.clone().into(), endpoint.created_at.into(), endpoint.updated_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_webhook_endpoint_secrets<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    secrets: impl Iterator<Item = &'a WebhookEndpointSecretRecord>,
) -> Result<(), DbErr> {
    for secret in secrets {
        exec(tx, r#"
            insert into zamapay_webhook_endpoint_secrets
                (state_key, secret_id, endpoint_id, project_id, status, secret_ciphertext, secret_preview, migrated_from_deterministic, created_at, revealed_at, retired_at, expires_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            "#, vec![
                state_key.into(), secret.secret_id.clone().into(), secret.endpoint_id.clone().into(),
                secret.project_id.clone().into(), encode_enum(&secret.status).into(),
                secret.secret_ciphertext.clone().into(), secret.secret_preview.clone().into(),
                secret.migrated_from_deterministic.into(), secret.created_at.into(),
                secret.revealed_at.into(), secret.retired_at.into(), secret.expires_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_subscriptions<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    subscriptions: impl Iterator<Item = &'a BillingSubscription>,
) -> Result<(), DbErr> {
    for subscription in subscriptions {
        exec(tx, r#"
            insert into zamapay_billing_subscriptions
                (state_key, owner_wallet_key, subscription_id, owner_wallet, plan, billing_cycle, status, pass_id, entitlement_version, entitlement_status, entitlement_tx_hash, subscription_check_handle, current_period_started_at, current_period_ends_at, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            "#, vec![
                state_key.into(), owner_key(&subscription.owner_wallet).into(),
                subscription.subscription_id.clone().into(), subscription.owner_wallet.clone().into(),
                encode_enum(&subscription.plan).into(), encode_enum(&subscription.billing_cycle).into(),
                encode_enum(&subscription.status).into(), subscription.pass_id.clone().into(),
                i64_from_u64(subscription.entitlement_version, "subscription.entitlement_version").into(),
                encode_enum(&subscription.entitlement_status).into(), subscription.entitlement_tx_hash.clone().into(),
                subscription.subscription_check_handle.clone().into(), subscription.current_period_started_at.into(),
                subscription.current_period_ends_at.into(), subscription.updated_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_billing_payments(
    tx: &DatabaseTransaction,
    state_key: &str,
    histories: &HashMap<String, Vec<BillingPaymentRecord>>,
) -> Result<(), DbErr> {
    for (owner_wallet_key, payments) in histories {
        for payment in payments {
            exec(tx, r#"
                insert into zamapay_billing_payments
                    (state_key, owner_wallet_key, payment_id, owner_wallet, plan, billing_cycle, amount_minor_units, currency, status, chain_tx_hash, subscription_check_handle, created_at)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                "#, vec![
                    state_key.into(), owner_wallet_key.clone().into(), payment.payment_id.clone().into(),
                    payment.owner_wallet.clone().into(), encode_enum(&payment.plan).into(),
                    encode_enum(&payment.billing_cycle).into(),
                    i64_from_u64(payment.amount_minor_units, "billing_payment.amount_minor_units").into(),
                    payment.currency.clone().into(), encode_enum(&payment.status).into(),
                    payment.chain_tx_hash.clone().into(), payment.subscription_check_handle.clone().into(),
                    payment.created_at.into(),
                ]).await?;
        }
    }
    Ok(())
}

async fn insert_evm_chains<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    chains: impl Iterator<Item = &'a EvmChain>,
) -> Result<(), DbErr> {
    for chain in chains {
        exec(
            tx,
            r#"
            insert into zamapay_evm_chains
                (state_key, chain_id, network, name, native_symbol, finality_threshold, enabled)
            values ($1,$2,$3,$4,$5,$6,$7)
            "#,
            vec![
                state_key.into(),
                i64_from_u64(chain.chain_id, "evm_chain.chain_id").into(),
                chain.network.clone().into(),
                chain.name.clone().into(),
                chain.native_symbol.clone().into(),
                i64_from_u64(chain.finality_threshold, "evm_chain.finality_threshold").into(),
                chain.enabled.into(),
            ],
        )
        .await?;
    }
    Ok(())
}

async fn insert_evm_chain_tokens<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    tokens: impl Iterator<Item = &'a EvmChainToken>,
) -> Result<(), DbErr> {
    for token in tokens {
        exec(tx, r#"
            insert into zamapay_evm_chain_tokens
                (state_key, token_id, chain_id, network, symbol, contract_address, decimals, min_amount_minor_units, enabled)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), token.token_id.clone().into(),
                i64_from_u64(token.chain_id, "evm_chain_token.chain_id").into(),
                token.network.clone().into(), token.symbol.clone().into(), token.contract_address.clone().into(),
                i32_from_u8(token.decimals).into(),
                i64_from_u64(token.min_amount_minor_units, "evm_chain_token.min_amount_minor_units").into(),
                token.enabled.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_evm_rpc_nodes<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    nodes: impl Iterator<Item = &'a EvmRpcNode>,
) -> Result<(), DbErr> {
    for node in nodes {
        exec(
            tx,
            r#"
            insert into zamapay_evm_rpc_nodes
                (state_key, rpc_node_id, chain_id, network, url, kind, enabled)
            values ($1,$2,$3,$4,$5,$6,$7)
            "#,
            vec![
                state_key.into(),
                node.rpc_node_id.clone().into(),
                i64_from_u64(node.chain_id, "evm_rpc_node.chain_id").into(),
                node.network.clone().into(),
                node.url.clone().into(),
                encode_enum(&node.kind).into(),
                node.enabled.into(),
            ],
        )
        .await?;
    }
    Ok(())
}

async fn insert_evm_settlement_contracts<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    settlement_contracts: impl Iterator<Item = &'a EvmSettlementContract>,
) -> Result<(), DbErr> {
    for settlement_contract in settlement_contracts {
        exec(
            tx,
            r#"
            insert into zamapay_evm_settlement_contracts
                (state_key, settlement_contract_id, chain_id, network, contract_address, status)
            values ($1,$2,$3,$4,$5,$6)
            "#,
            vec![
                state_key.into(),
                settlement_contract.settlement_contract_id.clone().into(),
                i64_from_u64(
                    settlement_contract.chain_id,
                    "evm_settlement_contract.chain_id",
                )
                .into(),
                settlement_contract.network.clone().into(),
                settlement_contract.contract_address.clone().into(),
                encode_enum(&settlement_contract.status).into(),
            ],
        )
        .await?;
    }
    Ok(())
}

async fn insert_evm_payment_intents<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    intents: impl Iterator<Item = &'a EvmPaymentIntent>,
) -> Result<(), DbErr> {
    for intent in intents {
        exec(tx, r#"
            insert into zamapay_evm_payment_intents
                (state_key, intent_id, checkout_session_id, project_id, settlement_intent_id, settlement_project_id, chain_id, network, token_symbol, token_contract, token_decimals, settlement_contract, expected_amount_minor_units, merchant_net_minor_units, platform_fee_minor_units, matched_amount_minor_units, status, detected_tx_hash, payer_address, confirmations, finality_threshold, created_at, updated_at, expires_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            "#, vec![
                state_key.into(), intent.intent_id.clone().into(), intent.checkout_session_id.clone().into(),
                intent.project_id.clone().into(), intent.settlement_intent_id.clone().into(), intent.settlement_project_id.clone().into(),
                i64_from_u64(intent.chain_id, "evm_payment_intent.chain_id").into(),
                intent.network.clone().into(), intent.token_symbol.clone().into(), intent.token_contract.clone().into(),
                i32_from_u8(intent.token_decimals).into(), intent.settlement_contract.clone().into(),
                i64_from_u64(intent.expected_amount_minor_units, "evm_payment_intent.expected_amount_minor_units").into(),
                i64_from_u64(intent.merchant_net_minor_units, "evm_payment_intent.merchant_net_minor_units").into(),
                i64_from_u64(intent.platform_fee_minor_units, "evm_payment_intent.platform_fee_minor_units").into(),
                i64_from_u64(intent.matched_amount_minor_units, "evm_payment_intent.matched_amount_minor_units").into(),
                encode_enum(&intent.status).into(), intent.detected_tx_hash.clone().into(), intent.payer_address.clone().into(),
                i64_from_u64(intent.confirmations, "evm_payment_intent.confirmations").into(),
                i64_from_u64(intent.finality_threshold, "evm_payment_intent.finality_threshold").into(),
                intent.created_at.into(), intent.updated_at.into(), intent.expires_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_evm_settlement_ledger<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    settlement_events: impl Iterator<Item = &'a EvmSettlementLedgerEntry>,
) -> Result<(), DbErr> {
    for settlement_event in settlement_events {
        exec(tx, r#"
            insert into zamapay_evm_settlement_ledger
                (state_key, settlement_event_id, chain_id, token_contract, tx_hash, log_index, block_number, block_hash, from_address, to_address, amount_minor_units, matched_intent_id, confirmations, status, observed_at, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            "#, vec![
                state_key.into(), settlement_event.settlement_event_id.clone().into(),
                i64_from_u64(settlement_event.chain_id, "evm_settlement_event.chain_id").into(),
                settlement_event.token_contract.clone().into(), settlement_event.tx_hash.clone().into(),
                i64_from_u64(settlement_event.log_index, "evm_settlement_event.log_index").into(),
                i64_from_u64(settlement_event.block_number, "evm_settlement_event.block_number").into(),
                settlement_event.block_hash.clone().into(),
                settlement_event.from_address.clone().into(), settlement_event.to_address.clone().into(),
                i64_from_u64(settlement_event.amount_minor_units, "evm_settlement_event.amount_minor_units").into(),
                settlement_event.matched_intent_id.clone().into(),
                i64_from_u64(settlement_event.confirmations, "evm_settlement_event.confirmations").into(),
                encode_enum(&settlement_event.status).into(), settlement_event.observed_at.into(), settlement_event.updated_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_evm_indexer_cursors<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    cursors: impl Iterator<Item = &'a EvmIndexerCursor>,
) -> Result<(), DbErr> {
    for cursor in cursors {
        exec(tx, r#"
            insert into zamapay_evm_indexer_cursors
                (state_key, cursor_id, chain_id, settlement_contract, last_scanned_block, last_finalized_block, updated_at)
            values ($1,$2,$3,$4,$5,$6,$7)
            "#, vec![
                state_key.into(),
                cursor.cursor_id.clone().into(),
                i64_from_u64(cursor.chain_id, "evm_indexer_cursor.chain_id").into(),
                cursor.settlement_contract.clone().into(),
                i64_from_u64(cursor.last_scanned_block, "evm_indexer_cursor.last_scanned_block").into(),
                i64_from_u64(cursor.last_finalized_block, "evm_indexer_cursor.last_finalized_block").into(),
                cursor.updated_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_invoices<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    invoices: impl Iterator<Item = &'a InvoiceRecord>,
) -> Result<(), DbErr> {
    for invoice in invoices {
        let billing = invoice.billing.clone();
        exec(tx, r#"
            insert into zamapay_invoices
                (state_key, invoice_id, project_id, checkout_session_id, environment, external_ref, title, merchant_name, amount_label, amount_minor_units, note, chain_invoice_id, chain_tx_hash, payment_tx_hash, payer_address, finality_confirmations, finality_threshold, webhook_status, webhook_attempt_count, webhook_next_retry_after_seconds, fulfillment_job_id, fulfillment_released_at, fulfillment_artifact_count, decrypt_request_id, decrypt_requested_at, decrypt_completed_at, decrypt_callback_sender, decrypt_replayed_callback_count, decrypt_pending_guard_trips, settlement_invoice_id, payment_truth, finality_status, decrypt_job_status, fulfillment_status, billing_plan, billing_fee_bps, billing_gross_amount_minor_units, billing_platform_fee_minor_units, billing_merchant_net_minor_units, payment_rail, payment_intent_id)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)
            "#, vec![
                state_key.into(), invoice.invoice_id.clone().into(), invoice.project_id.clone().into(),
                invoice.checkout_session_id.clone().into(), invoice.environment.clone().into(), invoice.external_ref.clone().into(),
                invoice.title.clone().into(), invoice.merchant_name.clone().into(), invoice.amount_label.clone().into(),
                i64_from_u64(invoice.amount_minor_units, "invoice.amount_minor_units").into(), invoice.note.clone().into(),
                invoice.chain_invoice_id.map(|value| i64_from_u64(value, "invoice.chain_invoice_id")).into(),
                invoice.chain_tx_hash.clone().into(), invoice.payment_tx_hash.clone().into(), invoice.payer_address.clone().into(),
                i64_from_u64(invoice.finality_confirmations, "invoice.finality_confirmations").into(),
                i64_from_u64(invoice.finality_threshold, "invoice.finality_threshold").into(),
                encode_enum(&invoice.webhook.status).into(), i32_from_u32(invoice.webhook.attempt_count, "invoice.webhook_attempt_count").into(),
                invoice.webhook.next_retry_after_seconds.map(|value| i32_from_u32(value, "invoice.webhook_retry")).into(),
                invoice.fulfillment_release.as_ref().map(|release| release.job_id.clone()).into(),
                invoice.fulfillment_release.as_ref().map(|release| release.released_at).into(),
                invoice.fulfillment_release.as_ref().map(|release| i32_from_u32(release.artifact_count, "invoice.fulfillment_artifact_count")).into(),
                invoice.decrypt_request.as_ref().map(|request| request.request_id.clone()).into(),
                invoice.decrypt_request.as_ref().map(|request| request.requested_at).into(),
                invoice.decrypt_request.as_ref().and_then(|request| request.completed_at).into(),
                invoice.decrypt_request.as_ref().and_then(|request| request.callback_sender.clone()).into(),
                invoice.decrypt_request.as_ref().map(|request| i32_from_u32(request.replayed_callback_count, "invoice.decrypt_replayed_callback_count")).unwrap_or_default().into(),
                i32_from_u32(invoice.decrypt_pending_guard_trips, "invoice.decrypt_pending_guard_trips").into(),
                i64_from_u64(invoice.snapshot.invoice_id, "invoice.settlement_invoice_id").into(),
                encode_enum(&invoice.snapshot.payment_truth).into(), encode_enum(&invoice.snapshot.finality_status).into(),
                encode_enum(&invoice.snapshot.decrypt_job_status).into(), encode_enum(&invoice.snapshot.fulfillment_status).into(),
                billing.as_ref().map(|value| encode_enum(&value.plan)).into(),
                billing.as_ref().map(|value| i32_from_u16(value.fee_bps)).into(),
                billing.as_ref().map(|value| i64_from_u64(value.gross_amount_minor_units, "invoice.billing_gross_amount")).into(),
                billing.as_ref().map(|value| i64_from_u64(value.platform_fee_minor_units, "invoice.billing_platform_fee")).into(),
                billing.as_ref().map(|value| i64_from_u64(value.merchant_net_minor_units, "invoice.billing_merchant_net")).into(),
                encode_enum(&invoice.payment_rail).into(), invoice.payment_intent_id.clone().into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_checkout_sessions<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    sessions: impl Iterator<Item = &'a CheckoutSession>,
) -> Result<(), DbErr> {
    for session in sessions {
        exec(tx, r#"
            insert into zamapay_checkout_sessions
                (state_key, checkout_session_id, project_id, environment, payment_rail, merchant_order_id, idempotency_key, invoice_id, chain_invoice_id, chain_tx_hash, payment_intent_id, checkout_url, title, amount_label, amount_minor_units, billing_plan, billing_fee_bps, billing_gross_amount_minor_units, billing_platform_fee_minor_units, billing_merchant_net_minor_units, note, success_url, cancel_url, status, created_at, updated_at, expires_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
            "#, vec![
                state_key.into(), session.checkout_session_id.clone().into(), session.project_id.clone().into(),
                encode_enum(&session.environment).into(), encode_enum(&session.payment_rail).into(), session.merchant_order_id.clone().into(),
                session.idempotency_key.clone().into(), session.invoice_id.clone().into(),
                session.chain_invoice_id.map(|value| i64_from_u64(value, "checkout.chain_invoice_id")).into(), session.chain_tx_hash.clone().into(),
                session.payment_intent_id.clone().into(), session.checkout_url.clone().into(), session.title.clone().into(), session.amount_label.clone().into(),
                i64_from_u64(session.amount_minor_units, "checkout.amount_minor_units").into(),
                encode_enum(&session.billing.plan).into(), i32_from_u16(session.billing.fee_bps).into(),
                i64_from_u64(session.billing.gross_amount_minor_units, "checkout.billing_gross_amount").into(),
                i64_from_u64(session.billing.platform_fee_minor_units, "checkout.billing_platform_fee").into(),
                i64_from_u64(session.billing.merchant_net_minor_units, "checkout.billing_merchant_net").into(),
                session.note.clone().into(), session.success_url.clone().into(), session.cancel_url.clone().into(),
                encode_enum(&session.status).into(), session.created_at.into(), session.updated_at.into(), session.expires_at.into(),
            ]).await?;
        for (key, value) in &session.metadata {
            exec(
                tx,
                r#"
                insert into zamapay_checkout_metadata
                    (state_key, checkout_session_id, metadata_key, metadata_value)
                values ($1,$2,$3,$4)
                "#,
                vec![
                    state_key.into(),
                    session.checkout_session_id.clone().into(),
                    key.clone().into(),
                    value.clone().into(),
                ],
            )
            .await?;
        }
    }
    Ok(())
}

async fn insert_idempotency(
    tx: &DatabaseTransaction,
    state_key: &str,
    idempotency_keys: &HashMap<String, String>,
) -> Result<(), DbErr> {
    for (scope, checkout_session_id) in idempotency_keys {
        exec(
            tx,
            r#"
            insert into zamapay_checkout_idempotency (state_key, scope, checkout_session_id)
            values ($1,$2,$3)
            "#,
            vec![
                state_key.into(),
                scope.clone().into(),
                checkout_session_id.clone().into(),
            ],
        )
        .await?;
    }
    Ok(())
}

async fn insert_webhook_events<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    events: impl Iterator<Item = &'a WebhookEventRecord>,
) -> Result<(), DbErr> {
    for event in events {
        exec(tx, r#"
            insert into zamapay_webhook_events
                (state_key, event_id, project_id, environment, event_type, subject_type, subject_id, payload_text, raw_payload, raw_payload_sha256, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            "#, vec![
                state_key.into(), event.event_id.clone().into(), event.project_id.clone().into(),
                encode_enum(&event.environment).into(), event.event_type.clone().into(), event.subject_type.clone().into(),
                event.subject_id.clone().into(), serde_json::to_string(&event.payload).expect("webhook payload should serialize").into(),
                event.raw_payload.clone().into(), event.raw_payload_sha256.clone().into(), event.created_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_webhook_deliveries<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    deliveries: impl Iterator<Item = &'a WebhookDeliveryRecord>,
) -> Result<(), DbErr> {
    for delivery in deliveries {
        exec(tx, r#"
            insert into zamapay_webhook_deliveries
                (state_key, delivery_id, event_id, endpoint_id, project_id, environment, attempt_count, status, signature_header, http_status, response_body, error, next_retry_at, created_at, delivered_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            "#, vec![
                state_key.into(), delivery.delivery_id.clone().into(), delivery.event_id.clone().into(),
                delivery.endpoint_id.clone().into(), delivery.project_id.clone().into(), encode_enum(&delivery.environment).into(),
                i32_from_u32(delivery.attempt_count, "webhook_delivery.attempt_count").into(),
                encode_enum(&delivery.status).into(), delivery.signature_header.clone().into(),
                delivery.http_status.map(i32::from).into(), delivery.response_body.clone().into(),
                delivery.error.clone().into(), delivery.next_retry_at.into(), delivery.created_at.into(), delivery.delivered_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_webhook_delivery_attempts<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    attempts: impl Iterator<Item = &'a WebhookDeliveryAttemptRecord>,
) -> Result<(), DbErr> {
    for attempt in attempts {
        exec(tx, r#"
            insert into zamapay_webhook_delivery_attempts
                (state_key, attempt_id, delivery_id, event_id, endpoint_id, project_id, request_headers_text, response_headers_text, http_status, response_body, error, attempted_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            "#, vec![
                state_key.into(), attempt.attempt_id.clone().into(), attempt.delivery_id.clone().into(),
                attempt.event_id.clone().into(), attempt.endpoint_id.clone().into(), attempt.project_id.clone().into(),
                serde_json::to_string(&attempt.request_headers).expect("webhook attempt request headers should serialize").into(),
                attempt.response_headers.as_ref().map(|headers| serde_json::to_string(headers).expect("webhook attempt response headers should serialize")).into(),
                attempt.http_status.map(i32::from).into(), attempt.response_body.clone().into(),
                attempt.error.clone().into(), attempt.attempted_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn insert_withdrawals<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    withdrawals: impl Iterator<Item = &'a ProjectWithdrawalRecord>,
) -> Result<(), DbErr> {
    for withdrawal in withdrawals {
        exec(tx, r#"
            insert into zamapay_project_withdrawals
                (state_key, withdrawal_id, project_id, amount_minor_units, chain_id, token_contract, settlement_contract, recipient_address, status, receipt, created_at, completed_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            "#, vec![
                state_key.into(), withdrawal.withdrawal_id.clone().into(), withdrawal.project_id.clone().into(),
                i64_from_u64(withdrawal.amount_minor_units, "withdrawal.amount_minor_units").into(),
                withdrawal.chain_id.map(|value| i64_from_u64(value, "withdrawal.chain_id")).into(),
                withdrawal.token_contract.clone().into(), withdrawal.settlement_contract.clone().into(),
                withdrawal.recipient_address.clone().into(), encode_enum(&withdrawal.status).into(), withdrawal.receipt.clone().into(),
                withdrawal.created_at.into(), withdrawal.completed_at.into(),
            ]).await?;
    }
    Ok(())
}

async fn select<T>(db: &DatabaseConnection, sql: &str, state_key: &str) -> Result<Vec<T>, DbErr>
where
    T: FromQueryResult + Sized + Send + Sync + 'static,
{
    T::find_by_statement(stmt(sql, vec![state_key.into()]))
        .all(db)
        .await
}

async fn exec(tx: &DatabaseTransaction, sql: &str, values: Vec<Value>) -> Result<(), DbErr> {
    tx.execute_raw(stmt(sql, values)).await.map(|_| ())
}

fn stmt(sql: &str, values: Vec<Value>) -> Statement {
    Statement::from_sql_and_values(BACKEND, sql, values)
}

fn payment_rail_setting_key(project_id: &str, payment_rail: PaymentRail) -> String {
    format!("{project_id}:{}", payment_rail.as_str())
}
