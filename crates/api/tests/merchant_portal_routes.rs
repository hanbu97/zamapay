use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use axum::routing::post;
use chrono::Utc;
use serde_json::json;
use shared::{
    SVIX_ID_HEADER, SVIX_SIGNATURE_HEADER, SVIX_TIMESTAMP_HEADER, verify_webhook_payload,
};
use std::time::Duration;
use tokio::sync::mpsc;
use tower::ServiceExt;

use api::{AppState, app};
use storage::PortalStore;
use uuid::Uuid;

async fn test_state() -> AppState {
    let database_url = std::env::var("ZAMAPAY_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set ZAMAPAY_TEST_DATABASE_URL or DATABASE_URL for API tests");
    let state_key = format!("test-api-{}", Uuid::new_v4().simple());
    AppState::with_portal(PortalStore::connect_with_state_key(database_url, state_key).await)
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[derive(Debug)]
struct CapturedWebhook {
    delivery_id: String,
    event_id: String,
    raw_body: String,
    signature: String,
    valid: bool,
}

#[tokio::test]
async fn dashboard_overview_requires_session() {
    let app = app(test_state().await);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/dashboard/overview")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn public_invoice_route_returns_not_found_without_created_invoice() {
    let app = app(test_state().await);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/invoices/invoice-0001")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn supported_evm_assets_are_public_but_watchlist_requires_operator_key() {
    let app = app(test_state().await);

    let assets = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/supported-assets")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(assets.status(), StatusCode::OK);
    let assets = response_json(assets).await;
    assert!(assets.as_array().unwrap().iter().any(|asset| {
        asset["chainId"] == 31337
            && asset["tokenSymbol"] == "USDT"
            && asset["receiverAddress"]
                .as_str()
                .is_some_and(|address| address.starts_with("0x"))
    }));

    let rejected = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/evm/watchlist")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let watchlist = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/evm/watchlist")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(watchlist.status(), StatusCode::OK);

    let cursor = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/evm/cursors")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "chainId": 31337,
                        "tokenContract": "0x0000000000000000000000000000000000001001",
                        "receiverAddress": "0x00000000000000000000000000000000000000f1",
                        "lastScannedBlock": 12,
                        "lastFinalizedBlock": 10
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(cursor.status(), StatusCode::OK);
    let cursor = response_json(cursor).await;
    assert_eq!(cursor["lastScannedBlock"], 12);
}

#[tokio::test]
async fn local_dev_contract_manifest_route_returns_generated_truth() {
    let app = app(test_state().await);

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/contracts/local-dev")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert!(
        json["network"]
            .as_str()
            .is_some_and(|network| !network.is_empty())
    );
    assert!(
        json["contracts"]["PrivateCheckoutSettlement"]
            .as_str()
            .is_some_and(|address| address.starts_with("0x"))
    );

    let legacy_alias = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/contracts/localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(legacy_alias.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn unknown_contract_manifest_route_returns_not_found() {
    let app = app(test_state().await);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/contracts/unknown-network")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn project_withdraw_route_rejects_unavailable_balance() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Withdraw boundary",
                        "environment": "local_dev",
                        "billingPlan": "free",
                        "webhookUrl": "http://127.0.0.1:9/webhooks/zamapay"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/withdrawals"))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "amountMinorUnits": 1,
                        "chainTxHash": "0x1111111111111111111111111111111111111111111111111111111111111111"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        String::from_utf8(body.to_vec()).unwrap(),
        "withdraw amount exceeds available project balance"
    );
}

#[tokio::test]
async fn operator_diagnostics_requires_separate_key() {
    let app = app(test_state().await);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/diagnostics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let invalid = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/diagnostics")
                .header("x-operator-key", "wrong-operator-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/diagnostics")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(authorized.status(), StatusCode::OK);

    let body = axum::body::to_bytes(authorized.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["operatorAuthRejections"], 2);
    assert_eq!(json["operatorActionRequired"], true);
}

#[tokio::test]
async fn create_invoice_requires_session_and_persists_new_record() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let app = app(state);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "title": "Test invoice",
                        "amountLabel": "66 cUSDT",
                        "amountMinorUnits": 66000000,
                        "note": "Issued from integration test"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("zamapay_session={}", seeded_session.session_id),
                )
                .body(Body::from(
                    json!({
                        "title": "Test invoice",
                        "amountLabel": "66 cUSDT",
                        "amountMinorUnits": 66000000,
                        "note": "Issued from integration test",
                        "externalRef": "chain-ref-0007",
                        "chainInvoiceId": 7,
                        "chainTxHash": "0xabc"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(authorized.status(), StatusCode::OK);
    let body = axum::body::to_bytes(authorized.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let new_invoice_id = json["invoiceId"].as_str().unwrap().to_string();
    assert_eq!(new_invoice_id, "chain-ref-0007");
    assert_eq!(json["amountMinorUnits"], 66000000);
    assert_eq!(json["chainInvoiceId"], 7);
    assert_eq!(json["chainTxHash"], "0xabc");
    assert_eq!(json["snapshot"]["paymentTruth"], "pending_payment");

    let fetched = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/invoices/{new_invoice_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(fetched.status(), StatusCode::OK);
}

#[tokio::test]
async fn operator_payment_projection_marks_invoice_paid() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let app = app(state);

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("zamapay_session={}", seeded_session.session_id),
                )
                .body(Body::from(
                    json!({
                        "title": "Projection invoice",
                        "amountLabel": "77 cUSDT",
                        "amountMinorUnits": 77000000,
                        "note": "Projection target",
                        "externalRef": "projection-ref-0008",
                        "chainInvoiceId": 8,
                        "chainTxHash": "0xcreate"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/invoices/projection-ref-0008/payment-projection")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "chainInvoiceId": 8,
                        "paymentTxHash": "0xpay",
                        "payerAddress": "0x0000000000000000000000000000000000000002"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let projected = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/invoices/projection-ref-0008/payment-projection")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "chainInvoiceId": 8,
                        "paymentTxHash": "0xpay",
                        "payerAddress": "0x0000000000000000000000000000000000000002"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(projected.status(), StatusCode::OK);
    let body = axum::body::to_bytes(projected.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["paymentTxHash"], "0xpay");
    assert_eq!(json["finalityConfirmations"], 0);
    assert_eq!(json["finalityThreshold"], 2);
    assert_eq!(json["snapshot"]["paymentTruth"], "paid");
    assert_eq!(json["snapshot"]["finalityStatus"], "awaiting_finality");

    let diagnostics = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/diagnostics")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(diagnostics.status(), StatusCode::OK);
    let body = axum::body::to_bytes(diagnostics.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["indexerCursor"]["latestChainInvoiceId"], 8);
    assert_eq!(json["indexerCursor"]["latestPaymentTxHash"], "0xpay");
    assert_eq!(json["indexerCursor"]["indexedInvoices"], 1);
    assert_eq!(json["indexerStalled"], true);
    assert_eq!(json["chainSyncStatus"], "stalled");
}

#[tokio::test]
async fn operator_payment_projection_can_target_chain_invoice_id() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let app = app(state);

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("zamapay_session={}", seeded_session.session_id),
                )
                .body(Body::from(
                    json!({
                        "title": "Chain projection invoice",
                        "amountLabel": "88 cUSDT",
                        "amountMinorUnits": 88000000,
                        "note": "Projection target by chain id",
                        "externalRef": "chain-projection-ref-0009",
                        "chainInvoiceId": 9,
                        "chainTxHash": "0xcreate"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let projected = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/9/payment-projection")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "paymentTxHash": "0xpay-chain",
                        "payerAddress": "0x0000000000000000000000000000000000000003"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(projected.status(), StatusCode::OK);
    let body = axum::body::to_bytes(projected.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["invoiceId"], "chain-projection-ref-0009");
    assert_eq!(json["chainInvoiceId"], 9);
    assert_eq!(json["paymentTxHash"], "0xpay-chain");
    assert_eq!(json["snapshot"]["paymentTruth"], "paid");

    let held = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/invoices/chain-projection-ref-0009/fulfillment")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(held.status(), StatusCode::OK);
    let body = axum::body::to_bytes(held.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["decision"], "hold");
    assert_eq!(json["artifacts"].as_array().unwrap().len(), 0);

    let still_waiting = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/9/confirmations")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "confirmations": 1,
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(still_waiting.status(), StatusCode::OK);
    let body = axum::body::to_bytes(still_waiting.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["snapshot"]["finalityStatus"], "awaiting_finality");
    assert_eq!(json["snapshot"]["fulfillmentStatus"], "not_ready");
    assert_eq!(json["finalityConfirmations"], 1);
    assert_eq!(json["finalityThreshold"], 2);

    let finality_safe = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/9/confirmations")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "confirmations": 2,
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(finality_safe.status(), StatusCode::OK);
    let body = axum::body::to_bytes(finality_safe.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["snapshot"]["finalityStatus"], "finality_safe");
    assert_eq!(json["snapshot"]["fulfillmentStatus"], "ready");
    assert_eq!(json["finalityConfirmations"], 2);
    assert_eq!(json["finalityThreshold"], 2);

    let released = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/invoices/chain-projection-ref-0009/fulfillment")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(released.status(), StatusCode::OK);
    let body = axum::body::to_bytes(released.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["decision"], "released");
    assert_eq!(json["artifacts"].as_array().unwrap().len(), 0);
    assert_eq!(json["release"]["invoiceId"], "chain-projection-ref-0009");
    assert_eq!(json["release"]["artifactCount"], 0);
    let release_job_id = json["release"]["jobId"]
        .as_str()
        .expect("release job id should be visible")
        .to_string();
    assert!(release_job_id.starts_with("ful_"));
    assert!(json["release"]["releasedAt"].as_str().is_some());

    let duplicate_release = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/invoices/chain-projection-ref-0009/fulfillment")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate_release.status(), StatusCode::OK);
    let body = axum::body::to_bytes(duplicate_release.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["decision"], "released");
    assert_eq!(json["artifacts"].as_array().unwrap().len(), 0);
    assert_eq!(json["release"]["jobId"], release_job_id);

    let released_invoice = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/invoices/chain-projection-ref-0009")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(released_invoice.status(), StatusCode::OK);
    let body = axum::body::to_bytes(released_invoice.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["snapshot"]["fulfillmentStatus"], "released");
    assert_eq!(json["fulfillmentRelease"]["jobId"], release_job_id);

    let missing = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/999/payment-projection")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "paymentTxHash": "0xmissing",
                        "payerAddress": "0x0000000000000000000000000000000000000003"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn operator_settlement_event_surfaces_diagnostics() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let app = app(state);

    let created = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .header(
                    "cookie",
                    format!("zamapay_session={}", seeded_session.session_id),
                )
                .body(Body::from(
                    json!({
                        "title": "Diagnostics invoice",
                        "amountLabel": "99 cUSDT",
                        "amountMinorUnits": 99000000,
                        "note": "Operator incident target",
                        "externalRef": "diagnostics-ref-0010",
                        "chainInvoiceId": 10,
                        "chainTxHash": "0xcreate"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);

    let timeout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/10/settlement-event")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "event": "decrypt_timeout",
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(timeout.status(), StatusCode::OK);

    let body = axum::body::to_bytes(timeout.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["snapshot"]["decryptJobStatus"], "failed_timeout");

    let deep_reorg = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/10/settlement-event")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "event": "deep_reorg_exception",
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(deep_reorg.status(), StatusCode::OK);

    let diagnostics = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/diagnostics")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(diagnostics.status(), StatusCode::OK);

    let body = axum::body::to_bytes(diagnostics.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["chainSyncStatus"], "intervention_required");
    assert_eq!(json["decryptTimeouts"], 1);
    assert_eq!(json["reorgExceptions"], 1);
    assert_eq!(json["frozenFulfillments"], 1);
    assert_eq!(json["operatorActionRequired"], true);
}

#[tokio::test]
async fn project_secret_checkout_uses_chain_invoice_authority() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "CardForge merchant",
                        "environment": "local_dev",
                        "billingPlan": "free",
                        "webhookUrl": "http://127.0.0.1:9/webhooks/zamapay"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();
    let endpoint_id = project["webhookEndpoint"]["endpointId"].as_str().unwrap();
    assert_eq!(project["project"]["billingPlan"], "free");
    assert!(project.get("webhookSecret").is_none());
    assert_eq!(
        project["invoiceAuthority"]["mode"],
        "platform_hosted_signer"
    );
    assert_eq!(
        project["invoiceAuthority"]["keyRef"],
        "local-dev-project-signer"
    );

    let key = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/project-secrets"))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "label": "CardForge backend",
                        "environment": "local_dev"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(key.status(), StatusCode::OK);
    let key = response_json(key).await;
    let api_key = key["secretKey"].as_str().unwrap();
    assert!(api_key.starts_with("zms_test_"));

    let first_bootstrap = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/project-secret/bootstrap")
                .header("authorization", format!("Bearer {api_key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_bootstrap.status(), StatusCode::OK);
    let first_bootstrap = response_json(first_bootstrap).await;
    let first_webhook_secret = first_bootstrap["webhookSecret"].as_str().unwrap();
    assert!(first_webhook_secret.starts_with("whsec_"));
    assert_ne!(
        project["webhookEndpoint"]["secretPreview"],
        first_bootstrap["webhookSecret"]
    );

    let rotated = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/projects/{project_id}/webhook-endpoints/{endpoint_id}/rotate-secret"
                ))
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rotated.status(), StatusCode::OK);
    let rotated = response_json(rotated).await;
    assert!(rotated.get("webhookSecret").is_none());

    let bootstrap = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/project-secret/bootstrap")
                .header("authorization", format!("Bearer {api_key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bootstrap.status(), StatusCode::OK);
    let bootstrap = response_json(bootstrap).await;
    assert_eq!(bootstrap["projectId"], project_id);
    assert_eq!(bootstrap["environment"], "local_dev");
    assert_eq!(bootstrap["webhookEndpointId"], endpoint_id);
    assert_ne!(bootstrap["webhookSecret"], first_webhook_secret);
    assert_ne!(
        rotated["endpoint"]["secretPreview"],
        bootstrap["webhookSecret"]
    );

    let bad_bootstrap = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/project-secret/bootstrap")
                .header("authorization", "Bearer zms_test_missing")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_bootstrap.status(), StatusCode::UNAUTHORIZED);

    let missing_key = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("idempotency-key", "order-1001")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-1001",
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Standalone project checkout"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_key.status(), StatusCode::UNAUTHORIZED);

    let checkout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .header("idempotency-key", "order-1001")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-1001",
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Standalone project checkout",
                        "chainInvoiceId": 11,
                        "chainTxHash": "0xcheckout",
                        "successUrl": "http://127.0.0.1:4101/success",
                        "cancelUrl": "http://127.0.0.1:4101/cancel"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(checkout.status(), StatusCode::OK);
    let checkout = response_json(checkout).await;
    let checkout_session_id = checkout["checkoutSessionId"].as_str().unwrap();
    let chain_invoice_id = checkout["chainInvoiceId"].as_u64().unwrap();
    assert!(
        checkout["checkoutUrl"]
            .as_str()
            .unwrap()
            .ends_with(checkout_session_id)
    );
    assert_eq!(checkout["invoiceId"], checkout_session_id);
    assert!(chain_invoice_id > 0);
    assert_eq!(checkout["billing"]["plan"], "free");
    assert_eq!(checkout["billing"]["feeBps"], 50);
    assert_eq!(checkout["billing"]["grossAmountMinorUnits"], 120000000);
    assert_eq!(checkout["billing"]["platformFeeMinorUnits"], 600000);
    assert_eq!(checkout["billing"]["merchantNetMinorUnits"], 119400000);

    let detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/projects/{project_id}/checkout-sessions/{checkout_session_id}"
                ))
                .header("authorization", format!("Bearer {api_key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = response_json(detail).await;
    assert_eq!(detail["billing"]["platformFeeMinorUnits"], 600000);
    assert_eq!(detail["billing"]["merchantNetMinorUnits"], 119400000);
}

#[tokio::test]
async fn project_payment_rail_route_updates_owner_setting() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Rail controls merchant",
                        "environment": "local_dev",
                        "billingPlan": "free"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!(
                    "/api/projects/{project_id}/payment-rails/evm_erc20"
                ))
                .header("content-type", "application/json")
                .body(Body::from(json!({ "enabled": false }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let updated = app
        .oneshot(
            Request::builder()
                .method(Method::PATCH)
                .uri(format!(
                    "/api/projects/{project_id}/payment-rails/evm_erc20"
                ))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(json!({ "enabled": false }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let updated = response_json(updated).await;
    assert!(
        updated["paymentRails"]
            .as_array()
            .unwrap()
            .iter()
            .any(|setting| {
                setting["paymentRail"] == "evm_erc20" && setting["enabled"] == false
            })
    );
    assert!(
        updated["paymentRails"]
            .as_array()
            .unwrap()
            .iter()
            .any(|setting| {
                setting["paymentRail"] == "zama_private" && setting["enabled"] == true
            })
    );
}

#[tokio::test]
async fn project_operator_projection_creates_project_outbox_records() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Outbox merchant",
                        "environment": "local_dev",
                        "webhookUrl": "http://127.0.0.1:9/webhooks/zamapay"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();

    let key = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/project-secrets"))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({ "label": "CardForge backend" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let api_key = response_json(key).await["secretKey"]
        .as_str()
        .unwrap()
        .to_string();

    let checkout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .header("idempotency-key", "order-2001")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-2001",
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Standalone project checkout",
                        "chainInvoiceId": 12,
                        "chainTxHash": "0xoutbox"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let chain_invoice_id = response_json(checkout).await["chainInvoiceId"]
        .as_u64()
        .unwrap();

    let paid = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/payment-projection"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "paymentTxHash": "0xpay",
                        "payerAddress": "0x0000000000000000000000000000000000000002"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paid.status(), StatusCode::OK);

    let finality = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/confirmations"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "confirmations": 2,
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(finality.status(), StatusCode::OK);

    let overview = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/projects/{project_id}"))
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview = response_json(overview).await;
    assert_eq!(overview["summary"]["totalCheckouts"], 1);
    assert_eq!(overview["summary"]["paidCheckouts"], 1);
    assert_eq!(overview["summary"]["grossVolumeMinorUnits"], 120000000);
    assert_eq!(overview["summary"]["platformFeeMinorUnits"], 600000);
    assert_eq!(overview["summary"]["merchantNetMinorUnits"], 119400000);
    assert_eq!(overview["webhookEvents"].as_array().unwrap().len(), 1);
    assert_eq!(overview["webhookDeliveries"].as_array().unwrap().len(), 1);
    assert!(
        overview["webhookDeliveries"][0]["status"] == "retry_scheduled"
            || overview["webhookDeliveries"][0]["status"] == "dead_letter"
    );
}

#[tokio::test]
async fn webhook_dispatch_uses_svix_headers_and_hides_replay_material() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let webhook_url = format!("http://{}/webhooks/zamapay", listener.local_addr().unwrap());
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Signed webhook merchant",
                        "environment": "local_dev",
                        "webhookUrl": webhook_url
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();
    let key = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/project-secrets"))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({ "label": "CardForge backend" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let api_key = response_json(key).await["secretKey"]
        .as_str()
        .unwrap()
        .to_string();

    let bootstrap = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/project-secret/bootstrap")
                .header("authorization", format!("Bearer {api_key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bootstrap.status(), StatusCode::OK);
    let webhook_secret = response_json(bootstrap).await["webhookSecret"]
        .as_str()
        .unwrap()
        .to_string();

    let (tx, mut rx) = mpsc::channel::<CapturedWebhook>(1);
    let secret_for_receiver = webhook_secret.clone();
    let receiver = axum::Router::new().route(
        "/webhooks/zamapay",
        post(move |headers: HeaderMap, body: Bytes| {
            let tx = tx.clone();
            let secret = secret_for_receiver.clone();
            async move {
                let header = |name: &str| {
                    headers
                        .get(name)
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default()
                        .to_string()
                };
                let delivery_id = header(SVIX_ID_HEADER);
                let timestamp = header(SVIX_TIMESTAMP_HEADER);
                let signature = header(SVIX_SIGNATURE_HEADER);
                let event_id = header("svix-event-id");
                let raw_body = String::from_utf8(body.to_vec()).unwrap();
                let valid = verify_webhook_payload(
                    &secret,
                    &delivery_id,
                    &timestamp,
                    &signature,
                    &raw_body,
                    Utc::now(),
                );
                tx.send(CapturedWebhook {
                    delivery_id,
                    event_id,
                    raw_body,
                    signature,
                    valid,
                })
                .await
                .ok();
                StatusCode::NO_CONTENT
            }
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, receiver).await.unwrap();
    });

    let checkout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .header("idempotency-key", "order-signed-webhook")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-signed-webhook",
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Standalone project checkout",
                        "chainInvoiceId": 12001,
                        "chainTxHash": "0xsignedwebhook"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let chain_invoice_id = response_json(checkout).await["chainInvoiceId"]
        .as_u64()
        .unwrap();

    let paid = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/payment-projection"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "paymentTxHash": "0xpay",
                        "payerAddress": "0x0000000000000000000000000000000000000002"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paid.status(), StatusCode::OK);

    let finality = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/confirmations"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "confirmations": 2,
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(finality.status(), StatusCode::OK);

    let captured = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .unwrap()
        .unwrap();
    server.abort();

    assert!(captured.valid);
    assert!(captured.delivery_id.starts_with("del_"));
    assert!(captured.event_id.starts_with("evt_"));
    assert!(captured.signature.starts_with("v1,"));
    let payload: serde_json::Value = serde_json::from_str(&captured.raw_body).unwrap();
    assert_eq!(payload["event"], "invoice.fulfillment_ready");

    let overview = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/projects/{project_id}"))
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview = response_json(overview).await;
    assert_eq!(overview["webhookDeliveries"][0]["status"], "delivered");
    assert!(
        overview["webhookDeliveries"][0]
            .get("signatureHeader")
            .is_none()
    );
    assert!(overview["webhookEvents"][0].get("rawPayload").is_none());
    assert_eq!(
        overview["webhookEvents"][0]["rawPayloadSha256"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
}
