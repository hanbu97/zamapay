use chrono::Utc;
use domain::{FinalityStatus, FulfillmentStatus, PaymentTruth};
use shared::{CreateCheckoutSessionRequest, ProjectEnvironmentKind};
use storage::InMemoryPortalStore;
use uuid::Uuid;

fn checkout_payload(order_id: &str, amount_minor_units: u64) -> CreateCheckoutSessionRequest {
    CreateCheckoutSessionRequest {
        merchant_order_id: order_id.to_string(),
        title: "CardForge starter bundle".to_string(),
        amount_label: "120 cUSDT".to_string(),
        amount_minor_units,
        note: "Standalone merchant checkout".to_string(),
        success_url: Some("http://127.0.0.1:4101/success".to_string()),
        cancel_url: Some("http://127.0.0.1:4101/cancel".to_string()),
        metadata: std::collections::BTreeMap::new(),
    }
}

fn temp_store_path(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("mermer-{label}-{}.json", Uuid::new_v4()))
}

#[test]
fn persisted_store_reloads_created_invoice() {
    let path = temp_store_path("created-invoice");
    let store = InMemoryPortalStore::persisted(path.clone());

    let invoice = store.create_invoice(
        "Persistent card checkout",
        "10 cUSDT",
        10_000_000,
        "Release after payment finality.",
        None,
        Some(42),
        Some("0xcreate"),
    );

    let reloaded = InMemoryPortalStore::persisted(path.clone())
        .invoice_by_id(&invoice.invoice_id)
        .expect("created invoice should reload from portal file");

    assert_eq!(reloaded.title, "Persistent card checkout");
    assert_eq!(reloaded.chain_invoice_id, Some(42));
    assert_eq!(reloaded.chain_tx_hash.as_deref(), Some("0xcreate"));

    let _ = std::fs::remove_file(path);
}

#[test]
fn persisted_store_reloads_operator_projection() {
    let path = temp_store_path("projection");
    let store = InMemoryPortalStore::persisted(path.clone());
    let invoice = store.create_invoice(
        "Projected checkout",
        "12 cUSDT",
        12_000_000,
        "Projection persistence.",
        None,
        Some(77),
        None,
    );

    let projected = store
        .project_chain_invoice_paid(77, "0xpaid", "0xpayer")
        .expect("chain invoice should exist");
    assert_eq!(projected.finality_confirmations, 0);
    assert_eq!(projected.finality_threshold, 2);

    let mut snapshot = projected.snapshot.clone();
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_finality_snapshot(77, snapshot, 2, 2)
        .expect("finality progress should persist");

    let reloaded = InMemoryPortalStore::persisted(path.clone())
        .invoice_by_id(&invoice.invoice_id)
        .expect("projected invoice should reload from portal file");

    assert_eq!(reloaded.payment_tx_hash.as_deref(), Some("0xpaid"));
    assert_eq!(reloaded.payer_address.as_deref(), Some("0xpayer"));
    assert_eq!(reloaded.snapshot.payment_truth, PaymentTruth::Paid);
    assert_eq!(reloaded.finality_confirmations, 2);
    assert_eq!(reloaded.finality_threshold, 2);
    assert_eq!(
        reloaded.snapshot.finality_status,
        FinalityStatus::FinalitySafe
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn duplicate_payment_projection_preserves_release_audit() {
    let store = InMemoryPortalStore::seeded();
    let invoice = store.create_invoice(
        "Exactly-once release",
        "12 cUSDT",
        12_000_000,
        "Release once.",
        None,
        Some(88),
        None,
    );

    store
        .project_chain_invoice_paid(88, "0xpaid-once", "0xpayer")
        .expect("chain invoice should exist");
    let mut snapshot = store
        .invoice_by_id(&invoice.invoice_id)
        .expect("invoice should exist")
        .snapshot;
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_snapshot(88, snapshot)
        .expect("snapshot should project");
    let released = store
        .release_fulfillment(&invoice.invoice_id, Utc::now(), 3)
        .expect("release should persist");
    let job_id = released
        .fulfillment_release
        .as_ref()
        .expect("release audit should exist")
        .job_id
        .clone();

    store
        .project_chain_invoice_paid(88, "0xpaid-once", "0xpayer")
        .expect("duplicate payment should be idempotent");
    let projected = store
        .invoice_by_id(&invoice.invoice_id)
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

#[test]
fn persisted_store_fails_fast_on_corrupt_file() {
    let path = temp_store_path("corrupt");
    std::fs::write(&path, "{not-json").expect("corrupt test file should write");

    let result = std::panic::catch_unwind({
        let path = path.clone();
        move || {
            let _ = InMemoryPortalStore::persisted(path);
        }
    });

    let _ = std::fs::remove_file(path);
    assert!(result.is_err());
}

#[test]
fn project_api_key_checkout_and_outbox_are_project_scoped() {
    let store = InMemoryPortalStore::seeded();
    let now = Utc::now();
    let created = store.create_project(
        "0x00000000000000000000000000000000000000aa",
        "CardForge merchant",
        ProjectEnvironmentKind::LocalDev,
        Some("http://127.0.0.1:8092/api/mermer-pay/webhook"),
        now,
    );
    let project_id = created.project.project_id;
    let api_key = store
        .create_project_api_key(
            &project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
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
        .expect("api key should create checkout");

    assert_eq!(checkout.project_id, project_id);
    assert_eq!(checkout.invoice_id, checkout.checkout_session_id);
    assert!(
        checkout
            .checkout_url
            .ends_with(&checkout.checkout_session_id)
    );
    assert!(checkout.chain_invoice_id > 0);

    let idempotent = store
        .create_checkout_session(
            &project_id,
            &api_key,
            "order-1001",
            checkout_payload("ignored-order", 1),
            "http://127.0.0.1:3001",
            now,
        )
        .expect("same idempotency key should return original checkout");
    assert_eq!(idempotent.checkout_session_id, checkout.checkout_session_id);
    assert_eq!(idempotent.amount_minor_units, 120_000_000);

    let projected = store
        .project_chain_invoice_paid(
            checkout.chain_invoice_id,
            "0xpayment",
            "0x00000000000000000000000000000000000000bb",
        )
        .expect("project checkout should project by chain invoice");
    let mut snapshot = projected.snapshot;
    snapshot.finality_status = FinalityStatus::FinalitySafe;
    snapshot.fulfillment_status = FulfillmentStatus::Ready;
    store
        .project_chain_invoice_finality_snapshot(checkout.chain_invoice_id, snapshot, 2, 2)
        .expect("finality-safe checkout should enqueue project event");

    let overview = store
        .project_overview(&project_id)
        .expect("project overview should exist");
    assert_eq!(overview.summary.total_checkouts, 1);
    assert_eq!(overview.summary.paid_checkouts, 1);
    assert_eq!(overview.webhook_events.len(), 1);
    assert_eq!(overview.webhook_deliveries.len(), 1);
    assert_eq!(overview.summary.pending_deliveries, 1);
    assert_eq!(
        overview.webhook_events[0].event_type,
        "invoice.fulfillment_ready"
    );
}

#[test]
fn revoked_or_cross_project_api_key_cannot_create_checkout() {
    let store = InMemoryPortalStore::seeded();
    let now = Utc::now();
    let first = store.create_project(
        "0x00000000000000000000000000000000000000aa",
        "First merchant",
        ProjectEnvironmentKind::LocalDev,
        None,
        now,
    );
    let second = store.create_project(
        "0x00000000000000000000000000000000000000aa",
        "Second merchant",
        ProjectEnvironmentKind::LocalDev,
        None,
        now,
    );
    let key = store
        .create_project_api_key(
            &first.project.project_id,
            ProjectEnvironmentKind::LocalDev,
            "CardForge",
            now,
        )
        .expect("project key should be issued");

    let cross_project = store.create_checkout_session(
        &second.project.project_id,
        &key.api_key,
        "cross-project",
        checkout_payload("cross-project", 1),
        "http://127.0.0.1:3001",
        now,
    );
    assert!(matches!(
        cross_project,
        Err(storage::CheckoutSessionError::Unauthorized)
    ));

    store
        .revoke_project_api_key(&first.project.project_id, &key.key_record.key_id, now)
        .expect("key should revoke");
    let revoked = store.create_checkout_session(
        &first.project.project_id,
        &key.api_key,
        "revoked",
        checkout_payload("revoked", 1),
        "http://127.0.0.1:3001",
        now,
    );
    assert!(matches!(
        revoked,
        Err(storage::CheckoutSessionError::Unauthorized)
    ));
}
