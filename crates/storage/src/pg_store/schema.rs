use sea_orm::{ConnectionTrait, DbErr, Statement};

const BACKEND: sea_orm::DbBackend = sea_orm::DbBackend::Postgres;

pub(crate) async fn ensure_schema<C>(connection: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    advisory_lock(connection).await?;
    for statement in SCHEMA_SQL {
        let statement = Statement::from_string(BACKEND, (*statement).to_string());
        if let Err(err) = connection.execute_raw(statement).await {
            advisory_unlock(connection).await?;
            return Err(err);
        }
    }
    advisory_unlock(connection).await?;
    Ok(())
}

static SCHEMA_SQL: &[&str] = &[
    r#"
    create table if not exists mermer_portal_counters (
        state_key text primary key,
        next_invoice_number bigint not null check (next_invoice_number > 0),
        updated_at timestamptz not null default now()
    )
    "#,
    "alter table mermer_portal_counters drop column if exists next_chain_invoice_id",
    r#"
    create table if not exists mermer_payment_projects (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        project_id text not null,
        name text not null,
        owner_wallet text not null,
        default_environment text not null,
        billing_plan text not null,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (state_key, project_id)
    )
    "#,
    "create index if not exists mermer_payment_projects_owner_idx on mermer_payment_projects (state_key, lower(owner_wallet))",
    r#"
    create table if not exists mermer_project_environments (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        environment_id text not null,
        project_id text not null,
        environment text not null,
        chain_id bigint,
        settlement_contract text,
        token_contract text,
        invoice_authority_id text not null,
        status text not null,
        primary key (state_key, environment_id)
    )
    "#,
    "create index if not exists mermer_project_environments_project_idx on mermer_project_environments (state_key, project_id)",
    r#"
    create table if not exists mermer_invoice_authorities (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        authority_id text not null,
        project_id text not null,
        environment text not null,
        mode text not null,
        signer_address text not null,
        key_ref text not null,
        merchant_registered boolean not null,
        created_at timestamptz not null,
        primary key (state_key, authority_id)
    )
    "#,
    "create index if not exists mermer_invoice_authorities_project_idx on mermer_invoice_authorities (state_key, project_id)",
    r#"
    create table if not exists mermer_project_api_keys (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        key_id text not null,
        project_id text not null,
        environment text not null,
        label text not null,
        prefix text not null,
        secret_hash text not null,
        created_at timestamptz not null,
        last_used_at timestamptz,
        revoked_at timestamptz,
        primary key (state_key, key_id)
    )
    "#,
    "create index if not exists mermer_project_api_keys_project_idx on mermer_project_api_keys (state_key, project_id)",
    "create index if not exists mermer_project_api_keys_prefix_idx on mermer_project_api_keys (state_key, project_id, prefix)",
    r#"
    create table if not exists mermer_webhook_endpoints (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        endpoint_id text not null,
        project_id text not null,
        environment text not null,
        url text not null,
        enabled boolean not null,
        secret_preview text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (state_key, endpoint_id)
    )
    "#,
    "create index if not exists mermer_webhook_endpoints_project_idx on mermer_webhook_endpoints (state_key, project_id)",
    r#"
    create table if not exists mermer_billing_subscriptions (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        owner_wallet_key text not null,
        subscription_id text not null,
        owner_wallet text not null,
        plan text not null,
        billing_cycle text not null,
        status text not null,
        pass_id text,
        entitlement_version bigint not null check (entitlement_version >= 0),
        entitlement_status text not null,
        entitlement_tx_hash text,
        subscription_check_handle text,
        current_period_started_at timestamptz not null,
        current_period_ends_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (state_key, owner_wallet_key)
    )
    "#,
    r#"
    create table if not exists mermer_billing_payments (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        owner_wallet_key text not null,
        payment_id text not null,
        owner_wallet text not null,
        plan text not null,
        billing_cycle text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        currency text not null,
        status text not null,
        chain_tx_hash text,
        subscription_check_handle text,
        created_at timestamptz not null,
        primary key (state_key, payment_id)
    )
    "#,
    "create index if not exists mermer_billing_payments_owner_idx on mermer_billing_payments (state_key, owner_wallet_key, created_at desc)",
    r#"
    create table if not exists mermer_invoices (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        invoice_id text not null,
        project_id text,
        checkout_session_id text,
        environment text,
        external_ref text,
        title text not null,
        merchant_name text not null,
        amount_label text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        note text not null,
        chain_invoice_id bigint,
        chain_tx_hash text,
        payment_tx_hash text,
        payer_address text,
        finality_confirmations bigint not null check (finality_confirmations >= 0),
        finality_threshold bigint not null check (finality_threshold >= 0),
        webhook_status text not null,
        webhook_attempt_count integer not null check (webhook_attempt_count >= 0),
        webhook_next_retry_after_seconds integer,
        fulfillment_job_id text,
        fulfillment_released_at timestamptz,
        fulfillment_artifact_count integer,
        decrypt_request_id text,
        decrypt_requested_at timestamptz,
        decrypt_completed_at timestamptz,
        decrypt_callback_sender text,
        decrypt_replayed_callback_count integer not null check (decrypt_replayed_callback_count >= 0),
        decrypt_pending_guard_trips integer not null check (decrypt_pending_guard_trips >= 0),
        settlement_invoice_id bigint not null check (settlement_invoice_id >= 0),
        payment_truth text not null,
        finality_status text not null,
        decrypt_job_status text not null,
        fulfillment_status text not null,
        billing_plan text,
        billing_fee_bps integer,
        billing_gross_amount_minor_units bigint,
        billing_platform_fee_minor_units bigint,
        billing_merchant_net_minor_units bigint,
        primary key (state_key, invoice_id)
    )
    "#,
    "create index if not exists mermer_invoices_project_idx on mermer_invoices (state_key, project_id)",
    "drop index if exists mermer_invoices_chain_invoice_idx",
    "create index if not exists mermer_invoices_chain_invoice_lookup_idx on mermer_invoices (state_key, chain_invoice_id, settlement_invoice_id desc) where chain_invoice_id is not null",
    r#"
    create table if not exists mermer_checkout_sessions (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        checkout_session_id text not null,
        project_id text not null,
        environment text not null,
        merchant_order_id text not null,
        idempotency_key text not null,
        invoice_id text not null,
        chain_invoice_id bigint not null check (chain_invoice_id >= 0),
        chain_tx_hash text not null,
        checkout_url text not null,
        title text not null,
        amount_label text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        billing_plan text not null,
        billing_fee_bps integer not null check (billing_fee_bps >= 0),
        billing_gross_amount_minor_units bigint not null check (billing_gross_amount_minor_units >= 0),
        billing_platform_fee_minor_units bigint not null check (billing_platform_fee_minor_units >= 0),
        billing_merchant_net_minor_units bigint not null check (billing_merchant_net_minor_units >= 0),
        note text not null,
        success_url text,
        cancel_url text,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        expires_at timestamptz not null,
        primary key (state_key, checkout_session_id)
    )
    "#,
    "create index if not exists mermer_checkout_sessions_project_idx on mermer_checkout_sessions (state_key, project_id)",
    "drop index if exists mermer_checkout_sessions_chain_invoice_idx",
    "create index if not exists mermer_checkout_sessions_chain_invoice_lookup_idx on mermer_checkout_sessions (state_key, chain_invoice_id, created_at desc)",
    r#"
    create table if not exists mermer_checkout_metadata (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        checkout_session_id text not null,
        metadata_key text not null,
        metadata_value text not null,
        primary key (state_key, checkout_session_id, metadata_key)
    )
    "#,
    "create index if not exists mermer_checkout_metadata_session_idx on mermer_checkout_metadata (state_key, checkout_session_id)",
    r#"
    create table if not exists mermer_checkout_idempotency (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        scope text not null,
        checkout_session_id text not null,
        primary key (state_key, scope)
    )
    "#,
    r#"
    create table if not exists mermer_webhook_events (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        event_id text not null,
        project_id text not null,
        environment text not null,
        event_type text not null,
        subject_type text not null,
        subject_id text not null,
        payload_text text not null,
        created_at timestamptz not null,
        primary key (state_key, event_id)
    )
    "#,
    "create index if not exists mermer_webhook_events_project_idx on mermer_webhook_events (state_key, project_id)",
    "create unique index if not exists mermer_webhook_events_subject_idx on mermer_webhook_events (state_key, subject_id)",
    r#"
    create table if not exists mermer_webhook_deliveries (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        delivery_id text not null,
        event_id text not null,
        endpoint_id text not null,
        project_id text not null,
        environment text not null,
        attempt_count integer not null check (attempt_count >= 0),
        status text not null,
        signature_header text,
        http_status integer,
        response_body text,
        error text,
        next_retry_at timestamptz,
        created_at timestamptz not null,
        delivered_at timestamptz,
        primary key (state_key, delivery_id)
    )
    "#,
    "create index if not exists mermer_webhook_deliveries_project_idx on mermer_webhook_deliveries (state_key, project_id)",
    "create index if not exists mermer_webhook_deliveries_event_idx on mermer_webhook_deliveries (state_key, event_id)",
    r#"
    create table if not exists mermer_project_withdrawals (
        state_key text not null references mermer_portal_counters(state_key) on delete cascade,
        withdrawal_id text not null,
        project_id text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        status text not null,
        receipt text not null,
        created_at timestamptz not null,
        completed_at timestamptz not null,
        primary key (state_key, withdrawal_id)
    )
    "#,
    "create index if not exists mermer_project_withdrawals_project_idx on mermer_project_withdrawals (state_key, project_id)",
];

async fn advisory_lock<C>(connection: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    let statement =
        Statement::from_string(BACKEND, "select pg_advisory_lock(770177001)".to_string());
    connection.query_one_raw(statement).await.map(|_| ())
}

async fn advisory_unlock<C>(connection: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    let statement =
        Statement::from_string(BACKEND, "select pg_advisory_unlock(770177001)".to_string());
    connection.query_one_raw(statement).await.map(|_| ())
}
