use std::collections::{BTreeMap, HashMap};

use sea_orm::{
    ConnectionTrait, Database, DatabaseConnection, DatabaseTransaction, DbBackend, DbErr,
    FromQueryResult, Statement, TransactionTrait, Value,
};
use shared::{
    BillingPaymentRecord, BillingSubscription, CheckoutSession, InvoiceRecord, PaymentProject,
    PaymentProjectEnvironment, ProjectInvoiceAuthority, ProjectWebhookEndpoint,
    ProjectWithdrawalRecord, WebhookDeliveryRecord, WebhookEventRecord,
};

use super::dto::{
    ApiKeyRow, AuthorityRow, BillingPaymentRow, CheckoutMetadataRow, CheckoutRow, CounterRow,
    EnvironmentRow, IdempotencyRow, InvoiceRow, PortalRecordSet, ProjectRow, SubscriptionRow,
    WebhookDeliveryRow, WebhookEndpointRow, WebhookEventRow, WithdrawalRow, encode_enum,
    i32_from_u16, i32_from_u32, i64_from_u64, owner_key,
};
use super::schema;

const BACKEND: DbBackend = DbBackend::Postgres;

pub(crate) async fn load_portal_records(database_url: &str, state_key: &str) -> PortalRecordSet {
    let db = Database::connect(database_url)
        .await
        .unwrap_or_else(|err| panic!("load normalized portal postgres state: {err}"));
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

pub(crate) async fn save_portal_records(
    database_url: &str,
    state_key: &str,
    records: &PortalRecordSet,
) {
    let db = Database::connect(database_url)
        .await
        .unwrap_or_else(|err| panic!("save normalized portal postgres state: {err}"));
    schema::ensure_schema(&db)
        .await
        .unwrap_or_else(|err| panic!("save normalized portal postgres state: {err}"));
    replace_portal_rows(&db, state_key, records)
        .await
        .unwrap_or_else(|err| panic!("save normalized portal postgres state: {err}"));
}

async fn normalized_state_exists(db: &DatabaseConnection, state_key: &str) -> Result<bool, DbErr> {
    #[derive(Debug, FromQueryResult)]
    struct CountRow {
        count: i64,
    }

    let row = CountRow::find_by_statement(stmt(
        "select count(*)::bigint as count from mermer_portal_counters where state_key = $1",
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
    let counters = CounterRow::find_by_statement(stmt(
        r#"
        select next_invoice_number
        from mermer_portal_counters
        where state_key = $1
        "#,
        vec![state_key.into()],
    ))
    .one(db)
    .await?
    .expect("portal counters should exist after schema initialization");

    let mut records = PortalRecordSet {
        next_invoice_number: u64::try_from(counters.next_invoice_number)
            .expect("next invoice number should be positive"),
        ..PortalRecordSet::default()
    };

    for row in select::<ProjectRow>(
        db,
        "select * from mermer_payment_projects where state_key = $1",
        state_key,
    )
    .await?
    {
        let project = row.into_domain();
        records.projects.insert(project.project_id.clone(), project);
    }
    for row in select::<EnvironmentRow>(
        db,
        "select * from mermer_project_environments where state_key = $1",
        state_key,
    )
    .await?
    {
        let environment = row.into_domain();
        records
            .environments
            .insert(environment.environment_id.clone(), environment);
    }
    for row in select::<AuthorityRow>(
        db,
        "select * from mermer_invoice_authorities where state_key = $1",
        state_key,
    )
    .await?
    {
        let authority = row.into_domain();
        records
            .invoice_authorities
            .insert(authority.authority_id.clone(), authority);
    }
    for row in select::<ApiKeyRow>(
        db,
        "select * from mermer_project_api_keys where state_key = $1",
        state_key,
    )
    .await?
    {
        let key = row.into_domain();
        records.api_keys.insert(key.record.key_id.clone(), key);
    }
    for row in select::<WebhookEndpointRow>(
        db,
        "select * from mermer_webhook_endpoints where state_key = $1",
        state_key,
    )
    .await?
    {
        let endpoint = row.into_domain();
        records
            .webhook_endpoints
            .insert(endpoint.endpoint_id.clone(), endpoint);
    }
    for row in select::<SubscriptionRow>(
        db,
        "select * from mermer_billing_subscriptions where state_key = $1",
        state_key,
    )
    .await?
    {
        let (key, subscription) = row.into_domain();
        records.subscriptions.insert(key, subscription);
    }
    for row in select::<BillingPaymentRow>(
        db,
        "select * from mermer_billing_payments where state_key = $1",
        state_key,
    )
    .await?
    {
        let (key, payment) = row.into_domain();
        records
            .billing_payments
            .entry(key)
            .or_default()
            .push(payment);
    }
    for row in select::<InvoiceRow>(
        db,
        "select * from mermer_invoices where state_key = $1",
        state_key,
    )
    .await?
    {
        let invoice = row.into_domain();
        records.invoices.insert(invoice.invoice_id.clone(), invoice);
    }

    let checkout_metadata = checkout_metadata_by_session(db, state_key).await?;
    for row in select::<CheckoutRow>(
        db,
        "select * from mermer_checkout_sessions where state_key = $1",
        state_key,
    )
    .await?
    {
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
    for row in select::<IdempotencyRow>(
        db,
        "select * from mermer_checkout_idempotency where state_key = $1",
        state_key,
    )
    .await?
    {
        records
            .idempotency_keys
            .insert(row.scope, row.checkout_session_id);
    }
    for row in select::<WebhookEventRow>(
        db,
        "select * from mermer_webhook_events where state_key = $1",
        state_key,
    )
    .await?
    {
        let event = row.into_domain();
        records.webhook_events.insert(event.event_id.clone(), event);
    }
    for row in select::<WebhookDeliveryRow>(
        db,
        "select * from mermer_webhook_deliveries where state_key = $1",
        state_key,
    )
    .await?
    {
        let delivery = row.into_domain();
        records
            .webhook_deliveries
            .insert(delivery.delivery_id.clone(), delivery);
    }
    for row in select::<WithdrawalRow>(
        db,
        "select * from mermer_project_withdrawals where state_key = $1",
        state_key,
    )
    .await?
    {
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
        "select * from mermer_checkout_metadata where state_key = $1",
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
        "delete from mermer_portal_counters where state_key = $1",
        vec![state_key.into()],
    )
    .await?;
    insert_counters(&tx, state_key, records).await?;
    insert_projects(&tx, state_key, records.projects.values()).await?;
    insert_environments(&tx, state_key, records.environments.values()).await?;
    insert_authorities(&tx, state_key, records.invoice_authorities.values()).await?;
    insert_api_keys(&tx, state_key, records.api_keys.values()).await?;
    insert_webhook_endpoints(&tx, state_key, records.webhook_endpoints.values()).await?;
    insert_subscriptions(&tx, state_key, records.subscriptions.values()).await?;
    insert_billing_payments(&tx, state_key, &records.billing_payments).await?;
    insert_invoices(&tx, state_key, records.invoices.values()).await?;
    insert_checkout_sessions(&tx, state_key, records.checkout_sessions.values()).await?;
    insert_idempotency(&tx, state_key, &records.idempotency_keys).await?;
    insert_webhook_events(&tx, state_key, records.webhook_events.values()).await?;
    insert_webhook_deliveries(&tx, state_key, records.webhook_deliveries.values()).await?;
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
        insert into mermer_portal_counters
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
            insert into mermer_payment_projects
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

async fn insert_environments<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    environments: impl Iterator<Item = &'a PaymentProjectEnvironment>,
) -> Result<(), DbErr> {
    for environment in environments {
        exec(tx, r#"
            insert into mermer_project_environments
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
            insert into mermer_invoice_authorities
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
            insert into mermer_project_api_keys
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
            insert into mermer_webhook_endpoints
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

async fn insert_subscriptions<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    subscriptions: impl Iterator<Item = &'a BillingSubscription>,
) -> Result<(), DbErr> {
    for subscription in subscriptions {
        exec(tx, r#"
            insert into mermer_billing_subscriptions
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
                insert into mermer_billing_payments
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

async fn insert_invoices<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    invoices: impl Iterator<Item = &'a InvoiceRecord>,
) -> Result<(), DbErr> {
    for invoice in invoices {
        let billing = invoice.billing.clone();
        exec(tx, r#"
            insert into mermer_invoices
                (state_key, invoice_id, project_id, checkout_session_id, environment, external_ref, title, merchant_name, amount_label, amount_minor_units, note, chain_invoice_id, chain_tx_hash, payment_tx_hash, payer_address, finality_confirmations, finality_threshold, webhook_status, webhook_attempt_count, webhook_next_retry_after_seconds, fulfillment_job_id, fulfillment_released_at, fulfillment_artifact_count, decrypt_request_id, decrypt_requested_at, decrypt_completed_at, decrypt_callback_sender, decrypt_replayed_callback_count, decrypt_pending_guard_trips, settlement_invoice_id, payment_truth, finality_status, decrypt_job_status, fulfillment_status, billing_plan, billing_fee_bps, billing_gross_amount_minor_units, billing_platform_fee_minor_units, billing_merchant_net_minor_units)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39)
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
            insert into mermer_checkout_sessions
                (state_key, checkout_session_id, project_id, environment, merchant_order_id, idempotency_key, invoice_id, chain_invoice_id, chain_tx_hash, checkout_url, title, amount_label, amount_minor_units, billing_plan, billing_fee_bps, billing_gross_amount_minor_units, billing_platform_fee_minor_units, billing_merchant_net_minor_units, note, success_url, cancel_url, status, created_at, updated_at, expires_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
            "#, vec![
                state_key.into(), session.checkout_session_id.clone().into(), session.project_id.clone().into(),
                encode_enum(&session.environment).into(), session.merchant_order_id.clone().into(),
                session.idempotency_key.clone().into(), session.invoice_id.clone().into(),
                i64_from_u64(session.chain_invoice_id, "checkout.chain_invoice_id").into(), session.chain_tx_hash.clone().into(),
                session.checkout_url.clone().into(), session.title.clone().into(), session.amount_label.clone().into(),
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
                insert into mermer_checkout_metadata
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
            insert into mermer_checkout_idempotency (state_key, scope, checkout_session_id)
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
            insert into mermer_webhook_events
                (state_key, event_id, project_id, environment, event_type, subject_type, subject_id, payload_text, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#, vec![
                state_key.into(), event.event_id.clone().into(), event.project_id.clone().into(),
                encode_enum(&event.environment).into(), event.event_type.clone().into(), event.subject_type.clone().into(),
                event.subject_id.clone().into(), serde_json::to_string(&event.payload).expect("webhook payload should serialize").into(),
                event.created_at.into(),
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
            insert into mermer_webhook_deliveries
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

async fn insert_withdrawals<'a>(
    tx: &DatabaseTransaction,
    state_key: &str,
    withdrawals: impl Iterator<Item = &'a ProjectWithdrawalRecord>,
) -> Result<(), DbErr> {
    for withdrawal in withdrawals {
        exec(tx, r#"
            insert into mermer_project_withdrawals
                (state_key, withdrawal_id, project_id, amount_minor_units, status, receipt, created_at, completed_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8)
            "#, vec![
                state_key.into(), withdrawal.withdrawal_id.clone().into(), withdrawal.project_id.clone().into(),
                i64_from_u64(withdrawal.amount_minor_units, "withdrawal.amount_minor_units").into(),
                encode_enum(&withdrawal.status).into(), withdrawal.receipt.clone().into(),
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
