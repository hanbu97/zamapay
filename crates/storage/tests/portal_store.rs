use chrono::{TimeDelta, Utc};
use domain::{FinalityStatus, FulfillmentStatus, PaymentTruth};
use shared::{
    BillingCycle, BillingEntitlementStatus, BillingPlan, CreateCheckoutSessionRequest,
    EvmIndexerCursorProjectionRequest, EvmPaymentIntent, EvmPaymentIntentStatus,
    EvmTransferProjectionRequest, EvmTransferStatus, PaymentRail, ProjectEnvironmentKind,
    SubscriptionEntitlementProjectionRequest, WEBHOOK_RETIRED_SECRET_LIMIT,
    WEBHOOK_RETIRED_SECRET_TTL_HOURS, webhook_payload_sha256,
};
use storage::{CheckoutSessionError, PortalStore, ProjectWithdrawalScope};
use uuid::Uuid;

fn checkout_chain_invoice_id(session: &shared::CheckoutSession) -> u64 {
    session
        .chain_invoice_id
        .expect("Zama private checkout should have a chain invoice id")
}

fn checkout_payload(order_id: &str, amount_minor_units: u64) -> CreateCheckoutSessionRequest {
    let chain_invoice_id = chain_invoice_id_for(order_id);
    CreateCheckoutSessionRequest {
        merchant_order_id: order_id.to_string(),
        title: "CardForge starter bundle".to_string(),
        amount_label: "120 cUSDT".to_string(),
        amount_minor_units,
        note: "Standalone merchant checkout".to_string(),
        success_url: Some("http://127.0.0.1:4101/success".to_string()),
        cancel_url: Some("http://127.0.0.1:4101/cancel".to_string()),
        payment_rail: None,
        evm_chain_id: None,
        evm_token_symbol: None,
        chain_invoice_id: Some(chain_invoice_id),
        chain_tx_hash: Some(format!("0x{chain_invoice_id:064x}")),
        metadata: std::collections::BTreeMap::new(),
    }
}

fn evm_checkout_payload(order_id: &str, amount_minor_units: u64) -> CreateCheckoutSessionRequest {
    let mut payload = checkout_payload(order_id, amount_minor_units);
    payload.payment_rail = Some(PaymentRail::EvmErc20);
    payload.evm_chain_id = Some(31_337);
    payload.evm_token_symbol = Some("USDT".to_string());
    payload.chain_invoice_id = None;
    payload.chain_tx_hash = None;
    payload
}

fn evm_transfer_request(
    intent: &EvmPaymentIntent,
    tx_hash: &str,
    amount_minor_units: u64,
    confirmations: u64,
) -> EvmTransferProjectionRequest {
    EvmTransferProjectionRequest {
        chain_id: intent.chain_id,
        token_contract: intent.token_contract.clone(),
        tx_hash: tx_hash.to_string(),
        log_index: 0,
        block_number: 10,
        block_hash: Some(
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        ),
        from_address: "0x00000000000000000000000000000000000000bb".to_string(),
        to_address: intent.receiver_address.clone(),
        amount_minor_units,
        confirmations,
    }
}

fn chain_invoice_id_for(order_id: &str) -> u64 {
    let mut id = 1_u64;
    for byte in order_id.bytes() {
        id = id.wrapping_mul(131).wrapping_add(u64::from(byte));
    }
    (id % 1_000_000_000).max(1)
}

async fn finalize_checkout(store: &PortalStore, chain_invoice_id: u64, payment_tx_hash: &str) {
    let paid = store
        .project_chain_invoice_paid(chain_invoice_id, payment_tx_hash, "0xpayer")
        .await
        .expect("chain invoice should be paid");
    let mut snapshot = paid.snapshot;
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_finality_snapshot(chain_invoice_id, snapshot, 2, 2)
        .await
        .expect("finality-safe checkout should project");
}

fn test_database_url() -> String {
    std::env::var("ZAMAPAY_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set ZAMAPAY_TEST_DATABASE_URL or DATABASE_URL for Postgres-backed storage tests")
}

fn test_state_key(label: &str) -> String {
    format!("test-{label}-{}", Uuid::new_v4().simple())
}

async fn test_store() -> PortalStore {
    store_for_state_key(&test_state_key("portal")).await
}

async fn store_for_state_key(state_key: &str) -> PortalStore {
    PortalStore::connect_with_state_key(test_database_url(), state_key).await
}

#[tokio::test]
async fn postgres_store_reloads_project_state() {
    let database_url = test_database_url();
    let state_key = test_state_key("project-state");

    let owner = format!("0x{:040x}", 170);
    let now = Utc::now();
    let store = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    let created = store
        .create_project(
            &owner,
            "Postgres CardForge",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id.clone();
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "Postgres",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let reloaded =
        PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    assert_eq!(reloaded.list_projects(&owner).await.len(), 1);
    assert_eq!(
        reloaded
            .project_overview(&project_id)
            .await
            .expect("project should reload")
            .api_keys
            .len(),
        1
    );

    let checkout = reloaded
        .create_checkout_session(
            &project_id,
            &api_key,
            "pg-order-1",
            checkout_payload("pg-order-1", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("persisted project secret should create checkout after reload");

    let reloaded_again =
        PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    let overview = reloaded_again
        .project_overview(&project_id)
        .await
        .expect("checkout should reload");
    assert_eq!(overview.payment_rails.len(), 2);
    assert!(
        overview
            .payment_rails
            .iter()
            .any(|setting| setting.payment_rail == PaymentRail::ZamaPrivate && setting.enabled)
    );
    assert!(
        overview
            .payment_rails
            .iter()
            .any(|setting| setting.payment_rail == PaymentRail::EvmErc20 && setting.enabled)
    );
    assert_eq!(overview.summary.total_checkouts, 1);
    assert_eq!(
        overview.checkout_sessions[0].checkout_session_id,
        checkout.checkout_session_id
    );
}

#[tokio::test]
async fn postgres_store_reloads_created_invoice() {
    let database_url = test_database_url();
    let state_key = test_state_key("created-invoice");
    let store = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;

    let invoice = store
        .create_invoice(
            "Persistent card checkout",
            "10 cUSDT",
            10_000_000,
            "Release after payment finality.",
            None,
            Some(42),
            Some("0xcreate"),
        )
        .await;

    let reloaded = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone())
        .await
        .invoice_by_id(&invoice.invoice_id)
        .await
        .expect("created invoice should reload from Postgres");

    assert_eq!(reloaded.title, "Persistent card checkout");
    assert_eq!(reloaded.chain_invoice_id, Some(42));
    assert_eq!(reloaded.chain_tx_hash.as_deref(), Some("0xcreate"));
}

#[tokio::test]
async fn postgres_store_reloads_operator_projection() {
    let database_url = test_database_url();
    let state_key = test_state_key("projection");
    let store = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    let invoice = store
        .create_invoice(
            "Projected checkout",
            "12 cUSDT",
            12_000_000,
            "Projection persistence.",
            None,
            Some(77),
            None,
        )
        .await;

    let projected = store
        .project_chain_invoice_paid(77, "0xpaid", "0xpayer")
        .await
        .expect("chain invoice should exist");
    assert_eq!(projected.finality_confirmations, 0);
    assert_eq!(projected.finality_threshold, 2);

    let mut snapshot = projected.snapshot.clone();
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_finality_snapshot(77, snapshot, 2, 2)
        .await
        .expect("finality progress should persist");

    let reloaded = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone())
        .await
        .invoice_by_id(&invoice.invoice_id)
        .await
        .expect("projected invoice should reload from Postgres");

    assert_eq!(reloaded.payment_tx_hash.as_deref(), Some("0xpaid"));
    assert_eq!(reloaded.payer_address.as_deref(), Some("0xpayer"));
    assert_eq!(reloaded.snapshot.payment_truth, PaymentTruth::Paid);
    assert_eq!(reloaded.finality_confirmations, 2);
    assert_eq!(reloaded.finality_threshold, 2);
    assert_eq!(
        reloaded.snapshot.finality_status,
        FinalityStatus::FinalitySafe
    );
}

#[tokio::test]
async fn duplicate_payment_projection_preserves_release_audit() {
    let store = test_store().await;
    let invoice = store
        .create_invoice(
            "Exactly-once release",
            "12 cUSDT",
            12_000_000,
            "Release once.",
            None,
            Some(88),
            None,
        )
        .await;

    store
        .project_chain_invoice_paid(88, "0xpaid-once", "0xpayer")
        .await
        .expect("chain invoice should exist");
    let mut snapshot = store
        .invoice_by_id(&invoice.invoice_id)
        .await
        .expect("invoice should exist")
        .snapshot;
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_snapshot(88, snapshot)
        .await
        .expect("snapshot should project");
    let released = store
        .release_fulfillment(&invoice.invoice_id, Utc::now(), 3)
        .await
        .expect("release should persist");
    let job_id = released
        .fulfillment_release
        .as_ref()
        .expect("release audit should exist")
        .job_id
        .clone();

    store
        .project_chain_invoice_paid(88, "0xpaid-once", "0xpayer")
        .await
        .expect("duplicate payment should be idempotent");
    let projected = store
        .invoice_by_id(&invoice.invoice_id)
        .await
        .expect("invoice should still exist");

    assert_eq!(
        projected.snapshot.finality_status,
        FinalityStatus::FinalitySafe
    );
    assert_eq!(
        projected.snapshot.fulfillment_status,
        FulfillmentStatus::Released
    );
    assert_eq!(
        projected
            .fulfillment_release
            .as_ref()
            .expect("release audit should remain")
            .job_id,
        job_id
    );
}

#[tokio::test]
async fn postgres_store_reloads_contract_default_subscription() {
    let database_url = test_database_url();
    let state_key = test_state_key("subscription");
    let store = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    let owner = "0x00000000000000000000000000000000000000aa";
    let created = store.billing_subscription(owner, Utc::now()).await;
    assert_eq!(created.subscription.plan, BillingPlan::Free);
    assert_eq!(
        created.subscription.entitlement_status,
        BillingEntitlementStatus::ContractDefault
    );

    let reloaded = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone())
        .await
        .billing_subscription(owner, Utc::now())
        .await;

    assert_eq!(reloaded.subscription.plan, BillingPlan::Free);
    assert_eq!(reloaded.subscription.billing_cycle, BillingCycle::Monthly);
    assert_eq!(
        reloaded.subscription.entitlement_status,
        BillingEntitlementStatus::ContractDefault
    );
    assert!(reloaded.subscription.pass_id.is_none());
    assert!(reloaded.payments.is_empty());
}

#[tokio::test]
async fn backend_subscription_upgrade_is_not_an_authority() {
    let store = test_store().await;
    let owner = "0x00000000000000000000000000000000000000aa";
    let now = Utc::now();

    assert!(
        store
            .upgrade_billing_subscription(
                owner,
                BillingPlan::Growth,
                BillingCycle::Annual,
                None,
                Some(
                    "0x1111111111111111111111111111111111111111111111111111111111111111"
                        .to_string()
                ),
                Some(
                    "0x2222222222222222222222222222222222222222222222222222222222222222"
                        .to_string()
                ),
                now,
            )
            .await
            .is_err()
    );

    let subscription = store.billing_subscription(owner, now).await;
    assert_eq!(subscription.subscription.plan, BillingPlan::Free);
    assert_eq!(
        subscription.subscription.entitlement_status,
        BillingEntitlementStatus::ContractDefault
    );
    assert!(subscription.payments.is_empty());
}

#[tokio::test]
async fn project_api_key_checkout_and_outbox_are_project_scoped() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "CardForge merchant",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-1001",
            checkout_payload("order-1001", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("project secret should create checkout");

    assert_eq!(checkout.project_id, project_id);
    assert_eq!(checkout.invoice_id, checkout.checkout_session_id);
    assert_eq!(checkout.billing.plan, BillingPlan::Free);
    assert_eq!(checkout.billing.fee_bps, 50);
    assert_eq!(checkout.billing.gross_amount_minor_units, 120_000_000);
    assert_eq!(checkout.billing.platform_fee_minor_units, 600_000);
    assert_eq!(checkout.billing.merchant_net_minor_units, 119_400_000);
    assert!(
        checkout
            .checkout_url
            .ends_with(&checkout.checkout_session_id)
    );
    assert!(checkout_chain_invoice_id(&checkout) > 0);

    let idempotent = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-1001",
            checkout_payload("ignored-order", 1),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("same idempotency key should return original checkout");
    assert_eq!(idempotent.checkout_session_id, checkout.checkout_session_id);
    assert_eq!(idempotent.amount_minor_units, 120_000_000);
    assert_eq!(idempotent.billing.platform_fee_minor_units, 600_000);
    assert_eq!(idempotent.billing.merchant_net_minor_units, 119_400_000);

    let projected = store
        .project_chain_invoice_paid(
            checkout_chain_invoice_id(&checkout),
            "0xpayment",
            "0x00000000000000000000000000000000000000bb",
        )
        .await
        .expect("project checkout should project by chain invoice");
    let mut snapshot = projected.snapshot;
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_finality_snapshot(
            checkout_chain_invoice_id(&checkout),
            snapshot,
            2,
            2,
        )
        .await
        .expect("finality-safe checkout should enqueue project event");

    let overview = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(overview.summary.total_checkouts, 1);
    assert_eq!(overview.summary.paid_checkouts, 1);
    assert_eq!(overview.summary.gross_volume_minor_units, 120_000_000);
    assert_eq!(overview.summary.platform_fee_minor_units, 600_000);
    assert_eq!(overview.summary.merchant_net_minor_units, 119_400_000);
    assert_eq!(overview.webhook_events.len(), 1);
    assert_eq!(overview.webhook_deliveries.len(), 1);
    assert_eq!(overview.summary.pending_deliveries, 1);
    assert_eq!(
        overview.webhook_events[0].event_type,
        "invoice.fulfillment_ready"
    );
    assert!(!overview.webhook_events[0].raw_payload.is_empty());
    assert_eq!(
        overview.webhook_events[0].raw_payload_sha256,
        webhook_payload_sha256(&overview.webhook_events[0].raw_payload)
    );
    let public_event = serde_json::to_value(&overview.webhook_events[0]).unwrap();
    assert!(public_event.get("rawPayload").is_none());
    assert_eq!(
        public_event["rawPayloadSha256"],
        overview.webhook_events[0].raw_payload_sha256
    );
}

#[tokio::test]
async fn webhook_endpoint_secret_rotation_keeps_current_and_retired_truth() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Webhook merchant",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let endpoint = created
        .webhook_endpoint
        .expect("project should create a webhook endpoint");
    let first_secret = created
        .webhook_secret
        .expect("project should reveal the first endpoint secret");

    assert!(first_secret.starts_with("whsec_"));
    assert_ne!(endpoint.secret_preview, first_secret);
    assert_eq!(
        store
            .active_webhook_secrets_for_endpoint(&endpoint.endpoint_id, now)
            .await,
        vec![first_secret.clone()]
    );

    let rotated = store
        .rotate_webhook_endpoint_secret(&project_id, &endpoint.endpoint_id, now)
        .await
        .expect("endpoint secret should rotate");
    assert_ne!(rotated.webhook_secret, first_secret);
    assert!(rotated.webhook_secret.starts_with("whsec_"));
    assert_ne!(rotated.endpoint.secret_preview, rotated.webhook_secret);

    let active = store
        .active_webhook_secrets_for_endpoint(&endpoint.endpoint_id, now)
        .await;
    assert_eq!(active.first(), Some(&rotated.webhook_secret));
    assert!(active.contains(&first_secret));

    let expired_window = now + TimeDelta::hours(WEBHOOK_RETIRED_SECRET_TTL_HOURS + 1);
    assert_eq!(
        store
            .active_webhook_secrets_for_endpoint(&endpoint.endpoint_id, expired_window)
            .await,
        vec![rotated.webhook_secret.clone()]
    );

    let mut latest = rotated.webhook_secret;
    for index in 0..(WEBHOOK_RETIRED_SECRET_LIMIT + 2) {
        let next = store
            .rotate_webhook_endpoint_secret(
                &project_id,
                &endpoint.endpoint_id,
                now + TimeDelta::minutes(index as i64 + 1),
            )
            .await
            .expect("endpoint secret should rotate repeatedly");
        latest = next.webhook_secret;
    }
    let active = store
        .active_webhook_secrets_for_endpoint(
            &endpoint.endpoint_id,
            now + TimeDelta::minutes((WEBHOOK_RETIRED_SECRET_LIMIT + 3) as i64),
        )
        .await;
    assert_eq!(active.first(), Some(&latest));
    assert!(active.len() <= WEBHOOK_RETIRED_SECRET_LIMIT + 1);
}

#[tokio::test]
async fn evm_checkout_uses_payment_intent_and_transfer_ledger_truth() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "ERC20 merchant",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(&project_id, ProjectEnvironmentKind::LocalDev, "ERC20", now)
        .await
        .expect("project key should be issued")
        .api_key;

    let payload = evm_checkout_payload("erc20-order-1", 120_000_000);
    let checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "erc20-order-1",
            payload,
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("ERC20 checkout should not require private chain evidence");

    assert_eq!(checkout.payment_rail, PaymentRail::EvmErc20);
    assert_eq!(checkout.chain_invoice_id, None);
    assert_eq!(checkout.chain_tx_hash, None);
    let intent_id = checkout
        .payment_intent_id
        .as_deref()
        .expect("ERC20 checkout should create a payment intent");
    let intent = store
        .evm_payment_intent_by_id(intent_id)
        .await
        .expect("payment intent should be stored");
    assert_eq!(
        intent.receiver_address,
        "0x00000000000000000000000000000000000000f1"
    );
    assert_eq!(intent.expected_amount_minor_units, 120_000_000);

    let public_open_checkout = store
        .public_checkout_by_id(&checkout.checkout_session_id)
        .await
        .expect("public checkout should load while receiver is leased");
    assert!(public_open_checkout.evm_payment_intent.is_some());
    assert_eq!(
        public_open_checkout
            .evm_asset
            .expect("leased checkout should still expose its payable EVM asset")
            .receiver_address,
        intent.receiver_address
    );

    let projected = store
        .project_evm_transfer(
            evm_transfer_request(
                &intent,
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                intent.expected_amount_minor_units,
                1,
            ),
            now + TimeDelta::seconds(5),
        )
        .await;

    let matched = projected
        .matched_intent
        .expect("transfer should match the open payment intent");
    assert_eq!(matched.intent_id, intent_id);
    let invoice = projected
        .invoice
        .expect("matched transfer should pay invoice");
    assert_eq!(invoice.payment_rail, PaymentRail::EvmErc20);
    assert_eq!(
        invoice.payment_tx_hash.as_deref(),
        Some("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    );
    assert_eq!(invoice.snapshot.payment_truth, PaymentTruth::Paid);
    assert_eq!(
        invoice.snapshot.finality_status,
        FinalityStatus::FinalitySafe
    );

    let public_checkout = store
        .public_checkout_by_id(&checkout.checkout_session_id)
        .await
        .expect("public checkout should load by checkout id");
    assert!(public_checkout.evm_payment_intent.is_some());
    assert!(public_checkout.evm_asset.is_some());

    let overview = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(overview.summary.paid_checkouts, 1);
    assert_eq!(overview.evm_payment_intents.len(), 1);
    assert_eq!(overview.evm_transfer_ledger.len(), 1);
    assert_eq!(overview.evm_asset_balances.len(), 1);
    assert_eq!(
        overview.evm_asset_balances[0].confirmed_minor_units,
        120_000_000
    );
    assert_eq!(
        overview.evm_asset_balances[0].withdrawable_minor_units,
        119_400_000
    );
    assert_eq!(overview.webhook_events.len(), 1);

    store
        .create_project_withdrawal(
            &project_id,
            119_400_000,
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            ProjectWithdrawalScope {
                chain_id: Some(intent.chain_id),
                token_contract: Some(intent.token_contract.clone()),
                receiver_address: Some(intent.receiver_address.clone()),
                recipient_address: Some("0x00000000000000000000000000000000000000aa".to_string()),
            },
            now + TimeDelta::seconds(10),
        )
        .await
        .expect("token-scoped withdraw should record");

    let after_withdraw = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist after withdraw");
    assert_eq!(
        after_withdraw.evm_asset_balances[0].confirmed_minor_units,
        120_000_000
    );
    assert_eq!(
        after_withdraw.evm_asset_balances[0].withdrawable_minor_units,
        0
    );
}

#[tokio::test]
async fn project_payment_rail_settings_gate_checkout_creation() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Rail-managed merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(&project_id, ProjectEnvironmentKind::LocalDev, "ERC20", now)
        .await
        .expect("project key should be issued")
        .api_key;

    store
        .update_project_payment_rail(&project_id, PaymentRail::ZamaPrivate, false, now)
        .await
        .expect("private rail setting should exist");

    let erc20_checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "rail-order-erc20",
            evm_checkout_payload("rail-order-erc20", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("disabled private rail must not block ERC20 checkout");
    assert_eq!(erc20_checkout.payment_rail, PaymentRail::EvmErc20);

    store
        .update_project_payment_rail(&project_id, PaymentRail::EvmErc20, false, now)
        .await
        .expect("ERC20 rail setting should exist");

    let rejected = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "rail-order-disabled",
            evm_checkout_payload("rail-order-disabled", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await;
    assert!(matches!(rejected, Err(CheckoutSessionError::RailDisabled)));
}

#[tokio::test]
async fn evm_receiver_pool_locks_addresses_for_open_intents() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Pool merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let first = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "pool-order-1",
            evm_checkout_payload("pool-order-1", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("first ERC20 checkout should reserve a receiver");
    let second = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "pool-order-2",
            evm_checkout_payload("pool-order-2", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("second ERC20 checkout should reserve another receiver");

    let first_intent = store
        .evm_payment_intent_by_id(first.payment_intent_id.as_deref().unwrap())
        .await
        .unwrap();
    let second_intent = store
        .evm_payment_intent_by_id(second.payment_intent_id.as_deref().unwrap())
        .await
        .unwrap();

    assert_ne!(first_intent.receiver_id, second_intent.receiver_id);
    assert_ne!(
        first_intent.receiver_address,
        second_intent.receiver_address
    );
    let watchlist = store.evm_indexer_watchlist(now).await;
    assert_eq!(watchlist.assets.len(), 2);
}

#[tokio::test]
async fn evm_underpaid_transfer_records_exception_without_paying_invoice() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Exception merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;
    let checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "underpaid-order",
            evm_checkout_payload("underpaid-order", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("ERC20 checkout should be created");
    let intent = store
        .evm_payment_intent_by_id(checkout.payment_intent_id.as_deref().unwrap())
        .await
        .unwrap();

    let projected = store
        .project_evm_transfer(
            evm_transfer_request(
                &intent,
                "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                intent.expected_amount_minor_units - 1,
                1,
            ),
            now + TimeDelta::seconds(5),
        )
        .await;

    assert_eq!(projected.transfer.status, EvmTransferStatus::Underpaid);
    let matched = projected
        .matched_intent
        .expect("underpay should link intent");
    assert_eq!(matched.status, EvmPaymentIntentStatus::Underpaid);
    assert_eq!(matched.matched_amount_minor_units, 119_999_999);
    let invoice = projected
        .invoice
        .expect("underpay should update invoice state");
    assert_eq!(invoice.snapshot.payment_truth, PaymentTruth::PendingPayment);
    assert_eq!(invoice.snapshot.finality_status, FinalityStatus::NotPaid);

    let overview = store.project_overview(&project_id).await.unwrap();
    assert_eq!(overview.summary.paid_checkouts, 0);
    assert_eq!(
        overview.evm_asset_balances[0].exception_minor_units,
        119_999_999
    );
    assert_eq!(overview.evm_asset_balances[0].withdrawable_minor_units, 0);
}

#[tokio::test]
async fn evm_indexer_cursor_is_projected_per_asset_receiver() {
    let store = test_store().await;
    let now = Utc::now();
    let cursor = store
        .project_evm_indexer_cursor(
            EvmIndexerCursorProjectionRequest {
                chain_id: 31_337,
                token_contract: "0x0000000000000000000000000000000000001001".to_string(),
                receiver_address: "0x00000000000000000000000000000000000000f1".to_string(),
                last_scanned_block: 42,
                last_finalized_block: 40,
            },
            now,
        )
        .await;

    assert_eq!(cursor.last_scanned_block, 42);
    assert_eq!(cursor.last_finalized_block, 40);
}

#[tokio::test]
async fn local_chain_invoice_ids_can_be_reused_after_chain_reset() {
    let database_url = test_database_url();
    let state_key = test_state_key("reused-chain-invoice");
    let store = PortalStore::connect_with_state_key(database_url.clone(), state_key.clone()).await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Reset tolerant merchant",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let mut old_payload = checkout_payload("order-before-reset", 120_000_000);
    old_payload.chain_invoice_id = Some(7);
    old_payload.chain_tx_hash = Some("0xbefore-reset".to_string());
    let old_checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-before-reset",
            old_payload,
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("first local chain invoice should persist");

    let mut new_payload = checkout_payload("order-after-reset", 40_000_000);
    new_payload.chain_invoice_id = Some(7);
    new_payload.chain_tx_hash = Some("0xafter-reset".to_string());
    let new_checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-after-reset",
            new_payload,
            "http://127.0.0.1:3001",
            now + TimeDelta::seconds(1),
        )
        .await
        .expect("reused local chain invoice id should persist");

    let reloaded = PortalStore::connect_with_state_key(database_url, state_key).await;
    let latest = reloaded
        .invoice_by_chain_invoice_id(7)
        .await
        .expect("reused chain invoice id should resolve to latest checkout");
    assert_eq!(latest.invoice_id, new_checkout.checkout_session_id);

    let paid = reloaded
        .project_chain_invoice_paid(7, "0xpayment-after-reset", "0xpayer")
        .await
        .expect("payment projection should target latest checkout");
    assert_eq!(paid.invoice_id, new_checkout.checkout_session_id);
    assert_eq!(
        reloaded
            .invoice_by_id(&old_checkout.checkout_session_id)
            .await
            .expect("old checkout remains stored")
            .payment_tx_hash,
        None
    );
}

#[tokio::test]
async fn project_overview_sorts_checkout_sessions_by_latest_activity() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Activity ordered merchant",
            ProjectEnvironmentKind::LocalDev,
            Some("http://127.0.0.1:8092/api/zamapay/webhook"),
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let older = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-older-paid",
            checkout_payload("order-older-paid", 120_000_000),
            "http://127.0.0.1:3001",
            now - TimeDelta::minutes(2),
        )
        .await
        .expect("older checkout should be created");
    let newer = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-newer-open",
            checkout_payload("order-newer-open", 120_000_000),
            "http://127.0.0.1:3001",
            now - TimeDelta::minutes(1),
        )
        .await
        .expect("newer checkout should be created");

    finalize_checkout(&store, checkout_chain_invoice_id(&older), "0xactivity").await;

    let overview = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(overview.checkout_sessions.len(), 2);
    assert_eq!(
        overview.checkout_sessions[0].checkout_session_id,
        older.checkout_session_id
    );
    assert_eq!(
        overview.checkout_sessions[1].checkout_session_id,
        newer.checkout_session_id
    );
}

#[tokio::test]
async fn checkout_billing_snapshot_uses_contract_default_without_chain_projection() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Default merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "Growth key",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-growth",
            checkout_payload("order-growth", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("checkout should be created");

    assert_eq!(checkout.billing.plan, BillingPlan::Free);
    assert_eq!(checkout.billing.fee_bps, 50);
    assert_eq!(checkout.billing.platform_fee_minor_units, 600_000);
    assert_eq!(checkout.billing.merchant_net_minor_units, 119_400_000);
}

#[tokio::test]
async fn chain_subscription_projection_reprices_only_new_checkout_sessions() {
    let store = test_store().await;
    let now = Utc::now();
    let owner = "0x00000000000000000000000000000000000000aa";
    let created = store
        .create_project(
            owner,
            "Upgradable merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;

    let free_checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-free",
            checkout_payload("order-free", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("free checkout should be created");
    assert_eq!(free_checkout.billing.plan, BillingPlan::Free);
    assert_eq!(free_checkout.billing.fee_bps, 50);
    assert_eq!(free_checkout.billing.platform_fee_minor_units, 600_000);
    assert_eq!(free_checkout.billing.merchant_net_minor_units, 119_400_000);

    assert!(
        store
            .upgrade_billing_subscription(
                owner,
                BillingPlan::Growth,
                BillingCycle::Monthly,
                None,
                None,
                None,
                now + chrono::TimeDelta::hours(1),
            )
            .await
            .is_err()
    );
    let unchanged_project = store
        .project_by_id(&project_id)
        .await
        .expect("project should exist");
    assert_eq!(unchanged_project.billing_plan, BillingPlan::Free);

    let projected =
        store
            .project_subscription_entitlement(
                owner,
                SubscriptionEntitlementProjectionRequest {
                    plan: BillingPlan::Growth,
                    billing_cycle: BillingCycle::Monthly,
                    pass_id: "pass_growth_0001".to_string(),
                    entitlement_version: 1,
                    entitlement_tx_hash:
                        "0x3333333333333333333333333333333333333333333333333333333333333333"
                            .to_string(),
                    subscription_check_handle:
                        "0x4444444444444444444444444444444444444444444444444444444444444444"
                            .to_string(),
                },
                None,
                now + chrono::TimeDelta::hours(1),
            )
            .await
            .expect("operator projection should anchor Growth entitlement");
    assert_eq!(projected.subscription.plan, BillingPlan::Growth);
    assert_eq!(
        projected.subscription.entitlement_status,
        BillingEntitlementStatus::Anchored
    );
    assert_eq!(projected.payments.len(), 1);
    assert_eq!(projected.payments[0].plan, BillingPlan::Growth);
    assert_eq!(projected.payments[0].amount_minor_units, 99_000_000);

    let second_checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-second",
            checkout_payload("order-second", 120_000_000),
            "http://127.0.0.1:3001",
            now + chrono::TimeDelta::hours(1),
        )
        .await
        .expect("new checkout should use anchored Growth subscription");
    assert_eq!(second_checkout.billing.plan, BillingPlan::Growth);
    assert_eq!(second_checkout.billing.fee_bps, 25);
    assert_eq!(second_checkout.billing.platform_fee_minor_units, 300_000);
    assert_eq!(
        second_checkout.billing.merchant_net_minor_units,
        119_700_000
    );

    let old_checkout = store
        .checkout_session_by_id(&free_checkout.checkout_session_id)
        .await
        .expect("old checkout should remain stored");
    assert_eq!(old_checkout.billing.plan, BillingPlan::Free);
    assert_eq!(old_checkout.billing.platform_fee_minor_units, 600_000);

    finalize_checkout(
        &store,
        checkout_chain_invoice_id(&free_checkout),
        "0xpaid-free",
    )
    .await;
    finalize_checkout(
        &store,
        checkout_chain_invoice_id(&second_checkout),
        "0xpaid-growth",
    )
    .await;

    let overview = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(overview.summary.total_checkouts, 2);
    assert_eq!(overview.summary.paid_checkouts, 2);
    assert_eq!(overview.summary.gross_volume_minor_units, 240_000_000);
    assert_eq!(overview.summary.platform_fee_minor_units, 900_000);
    assert_eq!(overview.summary.merchant_net_minor_units, 239_100_000);
}

#[tokio::test]
async fn project_withdrawal_reduces_withdrawable_balance() {
    let store = test_store().await;
    let now = Utc::now();
    let created = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Withdraw merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued")
        .api_key;
    let checkout = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "withdraw-order",
            checkout_payload("withdraw-order", 120_000_000),
            "http://127.0.0.1:3001",
            now,
        )
        .await
        .expect("checkout should be created");
    finalize_checkout(
        &store,
        checkout_chain_invoice_id(&checkout),
        "0xpaid-withdraw",
    )
    .await;

    let before = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(before.summary.withdrawable_minor_units, 119_400_000);
    assert_eq!(before.summary.withdrawn_minor_units, 0);

    let withdrawal = store
        .create_project_withdrawal(
            &project_id,
            119_400_000,
            "0x1111111111111111111111111111111111111111111111111111111111111111",
            ProjectWithdrawalScope::default(),
            now,
        )
        .await
        .expect("withdraw should record");
    assert_eq!(withdrawal.amount_minor_units, 119_400_000);

    let after = store
        .project_overview(&project_id)
        .await
        .expect("project overview should exist");
    assert_eq!(after.summary.withdrawable_minor_units, 0);
    assert_eq!(after.summary.withdrawn_minor_units, 119_400_000);
    assert_eq!(after.withdrawals.len(), 1);
}

#[tokio::test]
async fn revoked_or_cross_project_api_key_cannot_create_checkout() {
    let store = test_store().await;
    let now = Utc::now();
    let first = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "First merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let second = store
        .create_project(
            "0x00000000000000000000000000000000000000aa",
            "Second merchant",
            ProjectEnvironmentKind::LocalDev,
            None,
            now,
        )
        .await;
    let key = store
        .create_project_api_key(
            &first.project.project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .await
        .expect("project key should be issued");

    let cross_project = store
        .create_checkout_session(
            &second.project.project_id,
            &key.api_key,
            "cross-project",
            checkout_payload("cross-project", 1),
            "http://127.0.0.1:3001",
            now,
        )
        .await;
    assert!(matches!(
        cross_project,
        Err(storage::CheckoutSessionError::Unauthorized)
    ));

    store
        .revoke_project_api_key(&first.project.project_id, &key.key_record.key_id, now)
        .await
        .expect("key should revoke");
    let revoked = store
        .create_checkout_session(
            &first.project.project_id,
            &key.api_key,
            "revoked",
            checkout_payload("revoked", 1),
            "http://127.0.0.1:3001",
            now,
        )
        .await;
    assert!(matches!(
        revoked,
        Err(storage::CheckoutSessionError::Unauthorized)
    ));
}
