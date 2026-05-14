use sea_orm::{ConnectionTrait, DatabaseConnection, DbErr, Statement, TransactionTrait};

const BACKEND: sea_orm::DbBackend = sea_orm::DbBackend::Postgres;

pub(crate) async fn ensure_schema(connection: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = connection.begin().await?;
    advisory_lock(&transaction).await?;
    for statement in SCHEMA_SQL {
        let statement = Statement::from_string(BACKEND, (*statement).to_string());
        transaction.execute_raw(statement).await?;
    }
    transaction.commit().await
}

static SCHEMA_SQL: &[&str] = &[
    r#"
    create table if not exists zamapay_portal_counters (
        state_key text primary key,
        next_invoice_number bigint not null check (next_invoice_number > 0),
        updated_at timestamptz not null default now()
    )
    "#,
    "alter table zamapay_portal_counters drop column if exists next_chain_invoice_id",
    r#"
    create table if not exists zamapay_payment_projects (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_payment_projects_owner_idx on zamapay_payment_projects (state_key, lower(owner_wallet))",
    r#"
    create table if not exists zamapay_project_payment_rails (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        project_id text not null,
        payment_rail text not null,
        enabled boolean not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (state_key, project_id, payment_rail)
    )
    "#,
    "create index if not exists zamapay_project_payment_rails_project_idx on zamapay_project_payment_rails (state_key, project_id)",
    r#"
    create table if not exists zamapay_project_environments (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_project_environments_project_idx on zamapay_project_environments (state_key, project_id)",
    r#"
    create table if not exists zamapay_invoice_authorities (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_invoice_authorities_project_idx on zamapay_invoice_authorities (state_key, project_id)",
    r#"
    create table if not exists zamapay_project_api_keys (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_project_api_keys_project_idx on zamapay_project_api_keys (state_key, project_id)",
    "create index if not exists zamapay_project_api_keys_prefix_idx on zamapay_project_api_keys (state_key, project_id, prefix)",
    r#"
    create table if not exists zamapay_webhook_endpoints (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_webhook_endpoints_project_idx on zamapay_webhook_endpoints (state_key, project_id)",
    r#"
    create table if not exists zamapay_webhook_endpoint_secrets (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        secret_id text not null,
        endpoint_id text not null,
        project_id text not null,
        status text not null,
        secret_ciphertext text not null,
        secret_preview text not null,
        migrated_from_deterministic boolean not null default false,
        created_at timestamptz not null,
        revealed_at timestamptz,
        retired_at timestamptz,
        expires_at timestamptz,
        primary key (state_key, secret_id)
    )
    "#,
    "create unique index if not exists zamapay_webhook_endpoint_secrets_current_idx on zamapay_webhook_endpoint_secrets (state_key, endpoint_id) where status = 'current'",
    "create index if not exists zamapay_webhook_endpoint_secrets_endpoint_idx on zamapay_webhook_endpoint_secrets (state_key, endpoint_id, status, expires_at)",
    r#"
    create table if not exists zamapay_billing_subscriptions (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    create table if not exists zamapay_billing_payments (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_billing_payments_owner_idx on zamapay_billing_payments (state_key, owner_wallet_key, created_at desc)",
    r#"
    create table if not exists zamapay_invoices (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
        payment_rail text not null default 'zama_private',
        payment_intent_id text,
        primary key (state_key, invoice_id)
    )
    "#,
    "alter table zamapay_invoices add column if not exists payment_rail text not null default 'zama_private'",
    "alter table zamapay_invoices add column if not exists payment_intent_id text",
    "create index if not exists zamapay_invoices_project_idx on zamapay_invoices (state_key, project_id)",
    "create index if not exists zamapay_invoices_payment_intent_idx on zamapay_invoices (state_key, payment_intent_id) where payment_intent_id is not null",
    "drop index if exists zamapay_invoices_chain_invoice_idx",
    "create index if not exists zamapay_invoices_chain_invoice_lookup_idx on zamapay_invoices (state_key, chain_invoice_id, settlement_invoice_id desc) where chain_invoice_id is not null",
    r#"
    create table if not exists zamapay_checkout_sessions (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        checkout_session_id text not null,
        project_id text not null,
        environment text not null,
        payment_rail text not null default 'zama_private',
        merchant_order_id text not null,
        idempotency_key text not null,
        invoice_id text not null,
        chain_invoice_id bigint check (chain_invoice_id >= 0),
        chain_tx_hash text,
        payment_intent_id text,
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
    "alter table zamapay_checkout_sessions add column if not exists payment_rail text not null default 'zama_private'",
    "alter table zamapay_checkout_sessions alter column chain_invoice_id drop not null",
    "alter table zamapay_checkout_sessions alter column chain_tx_hash drop not null",
    "alter table zamapay_checkout_sessions add column if not exists payment_intent_id text",
    "create index if not exists zamapay_checkout_sessions_project_idx on zamapay_checkout_sessions (state_key, project_id)",
    "create index if not exists zamapay_checkout_sessions_payment_intent_idx on zamapay_checkout_sessions (state_key, payment_intent_id) where payment_intent_id is not null",
    "drop index if exists zamapay_checkout_sessions_chain_invoice_idx",
    "create index if not exists zamapay_checkout_sessions_chain_invoice_lookup_idx on zamapay_checkout_sessions (state_key, chain_invoice_id, created_at desc)",
    r#"
    create table if not exists zamapay_evm_chains (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        chain_id bigint not null check (chain_id > 0),
        network text not null,
        name text not null,
        native_symbol text not null,
        finality_threshold bigint not null check (finality_threshold > 0),
        enabled boolean not null,
        primary key (state_key, chain_id)
    )
    "#,
    "create unique index if not exists zamapay_evm_chains_network_idx on zamapay_evm_chains (state_key, network)",
    r#"
    create table if not exists zamapay_evm_chain_tokens (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        token_id text not null,
        chain_id bigint not null check (chain_id > 0),
        network text not null,
        symbol text not null,
        contract_address text not null,
        decimals integer not null check (decimals >= 0),
        min_amount_minor_units bigint not null check (min_amount_minor_units >= 0),
        enabled boolean not null,
        primary key (state_key, token_id)
    )
    "#,
    "create unique index if not exists zamapay_evm_chain_tokens_symbol_idx on zamapay_evm_chain_tokens (state_key, chain_id, upper(symbol))",
    "create index if not exists zamapay_evm_chain_tokens_contract_idx on zamapay_evm_chain_tokens (state_key, chain_id, lower(contract_address))",
    r#"
    create table if not exists zamapay_evm_rpc_nodes (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        rpc_node_id text not null,
        chain_id bigint not null check (chain_id > 0),
        network text not null,
        url text not null,
        kind text not null,
        enabled boolean not null,
        primary key (state_key, rpc_node_id)
    )
    "#,
    "create index if not exists zamapay_evm_rpc_nodes_chain_idx on zamapay_evm_rpc_nodes (state_key, chain_id, enabled)",
    "drop table if exists zamapay_evm_receiver_addresses",
    r#"
    create table if not exists zamapay_evm_settlement_contracts (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        settlement_contract_id text not null,
        chain_id bigint not null check (chain_id > 0),
        network text not null,
        contract_address text not null,
        status text not null,
        primary key (state_key, settlement_contract_id)
    )
    "#,
    "create index if not exists zamapay_evm_settlement_contracts_chain_idx on zamapay_evm_settlement_contracts (state_key, chain_id, status)",
    r#"
    create table if not exists zamapay_evm_payment_intents (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        intent_id text not null,
        checkout_session_id text not null,
        project_id text not null,
        settlement_intent_id text not null default '',
        settlement_project_id text not null default '',
        chain_id bigint not null check (chain_id > 0),
        network text not null,
        token_symbol text not null,
        token_contract text not null,
        token_decimals integer not null check (token_decimals >= 0),
        settlement_contract text not null,
        expected_amount_minor_units bigint not null check (expected_amount_minor_units > 0),
        merchant_net_minor_units bigint not null default 0 check (merchant_net_minor_units >= 0),
        platform_fee_minor_units bigint not null default 0 check (platform_fee_minor_units >= 0),
        matched_amount_minor_units bigint not null default 0 check (matched_amount_minor_units >= 0),
        status text not null,
        detected_tx_hash text,
        payer_address text,
        confirmations bigint not null check (confirmations >= 0),
        finality_threshold bigint not null check (finality_threshold > 0),
        created_at timestamptz not null,
        updated_at timestamptz not null,
        expires_at timestamptz not null,
        primary key (state_key, intent_id)
    )
    "#,
    "alter table zamapay_evm_payment_intents add column if not exists settlement_intent_id text not null default ''",
    "alter table zamapay_evm_payment_intents add column if not exists settlement_project_id text not null default ''",
    "alter table zamapay_evm_payment_intents add column if not exists settlement_contract text not null default ''",
    "alter table zamapay_evm_payment_intents add column if not exists merchant_net_minor_units bigint not null default 0",
    "alter table zamapay_evm_payment_intents add column if not exists platform_fee_minor_units bigint not null default 0",
    "alter table zamapay_evm_payment_intents add column if not exists matched_amount_minor_units bigint not null default 0",
    "drop index if exists zamapay_evm_payment_intents_open_idx",
    "alter table zamapay_evm_payment_intents drop column if exists receiver_id",
    "alter table zamapay_evm_payment_intents drop column if exists receiver_address",
    "create index if not exists zamapay_evm_payment_intents_open_idx on zamapay_evm_payment_intents (state_key, chain_id, lower(token_contract), lower(settlement_contract), expected_amount_minor_units, status)",
    "create index if not exists zamapay_evm_payment_intents_settlement_intent_idx on zamapay_evm_payment_intents (state_key, lower(settlement_intent_id))",
    "create index if not exists zamapay_evm_payment_intents_project_idx on zamapay_evm_payment_intents (state_key, project_id, updated_at desc)",
    "drop table if exists zamapay_evm_transfer_ledger",
    r#"
    create table if not exists zamapay_evm_settlement_ledger (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        settlement_event_id text not null,
        chain_id bigint not null check (chain_id > 0),
        token_contract text not null,
        tx_hash text not null,
        log_index bigint not null check (log_index >= 0),
        block_number bigint not null check (block_number >= 0),
        block_hash text,
        from_address text not null,
        to_address text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        matched_intent_id text,
        confirmations bigint not null check (confirmations >= 0),
        status text not null,
        observed_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (state_key, settlement_event_id)
    )
    "#,
    "alter table zamapay_evm_settlement_ledger add column if not exists block_hash text",
    "create unique index if not exists zamapay_evm_settlement_ledger_log_idx on zamapay_evm_settlement_ledger (state_key, chain_id, lower(token_contract), lower(tx_hash), log_index)",
    "create index if not exists zamapay_evm_settlement_ledger_intent_idx on zamapay_evm_settlement_ledger (state_key, matched_intent_id) where matched_intent_id is not null",
    r#"
    create table if not exists zamapay_evm_indexer_cursors (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        cursor_id text not null,
        chain_id bigint not null check (chain_id > 0),
        settlement_contract text not null,
        last_scanned_block bigint not null check (last_scanned_block >= 0),
        last_finalized_block bigint not null check (last_finalized_block >= 0),
        updated_at timestamptz not null,
        primary key (state_key, cursor_id)
    )
    "#,
    "alter table zamapay_evm_indexer_cursors add column if not exists settlement_contract text not null default ''",
    "drop index if exists zamapay_evm_indexer_cursors_asset_idx",
    "alter table zamapay_evm_indexer_cursors drop column if exists token_contract",
    "alter table zamapay_evm_indexer_cursors drop column if exists receiver_address",
    "create unique index if not exists zamapay_evm_indexer_cursors_settlement_idx on zamapay_evm_indexer_cursors (state_key, chain_id, lower(settlement_contract))",
    r#"
    create table if not exists zamapay_checkout_metadata (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        checkout_session_id text not null,
        metadata_key text not null,
        metadata_value text not null,
        primary key (state_key, checkout_session_id, metadata_key)
    )
    "#,
    "create index if not exists zamapay_checkout_metadata_session_idx on zamapay_checkout_metadata (state_key, checkout_session_id)",
    r#"
    create table if not exists zamapay_checkout_idempotency (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        scope text not null,
        checkout_session_id text not null,
        primary key (state_key, scope)
    )
    "#,
    r#"
    create table if not exists zamapay_webhook_events (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        event_id text not null,
        project_id text not null,
        environment text not null,
        event_type text not null,
        subject_type text not null,
        subject_id text not null,
        payload_text text not null,
        raw_payload text not null default '',
        raw_payload_sha256 text not null default '',
        created_at timestamptz not null,
        primary key (state_key, event_id)
    )
    "#,
    "alter table zamapay_webhook_events add column if not exists raw_payload text not null default ''",
    "alter table zamapay_webhook_events add column if not exists raw_payload_sha256 text not null default ''",
    "create index if not exists zamapay_webhook_events_project_idx on zamapay_webhook_events (state_key, project_id)",
    "create unique index if not exists zamapay_webhook_events_subject_idx on zamapay_webhook_events (state_key, subject_id)",
    r#"
    create table if not exists zamapay_webhook_deliveries (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
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
    "create index if not exists zamapay_webhook_deliveries_project_idx on zamapay_webhook_deliveries (state_key, project_id)",
    "create index if not exists zamapay_webhook_deliveries_event_idx on zamapay_webhook_deliveries (state_key, event_id)",
    r#"
    create table if not exists zamapay_webhook_delivery_attempts (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        attempt_id text not null,
        delivery_id text not null,
        event_id text not null,
        endpoint_id text not null,
        project_id text not null,
        request_headers_text text not null,
        response_headers_text text,
        http_status integer,
        response_body text,
        error text,
        attempted_at timestamptz not null,
        primary key (state_key, attempt_id)
    )
    "#,
    "create index if not exists zamapay_webhook_delivery_attempts_delivery_idx on zamapay_webhook_delivery_attempts (state_key, delivery_id, attempted_at)",
    r#"
    create table if not exists zamapay_project_withdrawals (
        state_key text not null references zamapay_portal_counters(state_key) on delete cascade,
        withdrawal_id text not null,
        project_id text not null,
        amount_minor_units bigint not null check (amount_minor_units >= 0),
        chain_id bigint,
        token_contract text,
        settlement_contract text,
        recipient_address text,
        status text not null,
        receipt text not null,
        created_at timestamptz not null,
        completed_at timestamptz not null,
        primary key (state_key, withdrawal_id)
    )
    "#,
    "alter table zamapay_project_withdrawals add column if not exists chain_id bigint",
    "alter table zamapay_project_withdrawals add column if not exists token_contract text",
    "alter table zamapay_project_withdrawals add column if not exists settlement_contract text",
    "alter table zamapay_project_withdrawals drop column if exists receiver_address",
    "alter table zamapay_project_withdrawals add column if not exists recipient_address text",
    "create index if not exists zamapay_project_withdrawals_project_idx on zamapay_project_withdrawals (state_key, project_id)",
    "create index if not exists zamapay_project_withdrawals_asset_idx on zamapay_project_withdrawals (state_key, project_id, chain_id, lower(token_contract)) where chain_id is not null and token_contract is not null",
];

async fn advisory_lock<C>(connection: &C) -> Result<(), DbErr>
where
    C: ConnectionTrait,
{
    let statement = Statement::from_string(
        BACKEND,
        "select pg_advisory_xact_lock(770177001)".to_string(),
    );
    connection.query_one_raw(statement).await.map(|_| ())
}
