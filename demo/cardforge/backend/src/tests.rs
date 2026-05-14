use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::Path,
    http::{Request, header},
};
use serde_json::json;
use tokio::net::TcpListener;
use tower::ServiceExt;
use uuid::Uuid;
use webhook_verifier::{WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS, sign_webhook_payload_with_timestamp};

use super::*;

static TEST_STATE_INIT: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const TEST_WEBHOOK_SECRET: &str = "whsec_dGVzdA";
const RETIRED_WEBHOOK_SECRET: &str = "whsec_cmV0aXJlZF9zZWNyZXQ";

#[test]
fn detects_only_the_cardforge_demo_backend_listener() {
    assert!(is_cardforge_backend_command(
        "/tmp/predict/demo/cardforge/backend/target/debug/cardforge-backend"
    ));
    assert!(is_cardforge_backend_command(
        "target/debug/cardforge-backend"
    ));
    assert!(!is_cardforge_backend_command("node apps/web/server.js"));
    assert!(!is_cardforge_backend_command("target/debug/other-backend"));
}

#[test]
fn parses_lsof_listener_pids_without_trusting_noise() {
    assert_eq!(
        parse_lsof_pids(b"123\n456\nbad\n123\n"),
        vec![123, 456, 123]
    );
}

#[tokio::test]
async fn checkout_uses_project_secret_key_and_drops_browser_cookie() {
    let captured = Arc::new(Mutex::new(None::<(String, HeaderMap)>));
    let fake_zamapay = fake_zamapay_api(captured.clone()).await;
    let state = test_state(test_config(
        &fake_zamapay,
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let response = app(state)
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .header(header::COOKIE, "zamapay_session=must-not-forward")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["checkoutSessionId"], "cs_cardforge");
    assert_eq!(json["chainInvoiceId"], 1001);
    assert_eq!(json["billing"]["platformFeeMinorUnits"], 600000);
    assert_eq!(json["billing"]["merchantNetMinorUnits"], 119400000);

    let (project_id, headers) = captured
        .lock()
        .expect("captured request lock should work")
        .clone()
        .expect("fake ZamaPay API should receive checkout request");
    assert_eq!(project_id, "proj_cardforge");
    assert_eq!(
        headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
        Some("Bearer zms_test_secret")
    );
    assert!(headers.get(header::COOKIE).is_none());
    assert!(
        headers
            .get("idempotency-key")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("cardforge-"))
    );
}

#[tokio::test]
async fn checkout_can_forward_zero_based_local_chain_invoice() {
    let captured = Arc::new(Mutex::new(None::<Value>));
    let fake_zamapay = fake_zamapay_api_with_local_chain(captured.clone()).await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zms_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = test_state(config).await;
    let response = app(state)
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["chainInvoiceId"], 0);

    let payload = captured
        .lock()
        .expect("captured checkout request lock should work")
        .clone()
        .expect("fake ZamaPay API should receive checkout request");
    assert_eq!(payload["chainInvoiceId"], 0);
    assert_eq!(payload["chainTxHash"], format!("0x{:064x}", 0));
}

#[tokio::test]
async fn checkout_consumes_prepared_chain_invoice() {
    let captured = Arc::new(Mutex::new(None::<Value>));
    let chain_invoice_calls = Arc::new(Mutex::new(0_u32));
    let fake_zamapay =
        fake_zamapay_api_with_local_chain_counter(captured.clone(), chain_invoice_calls.clone())
            .await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zms_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let service = app(test_state(config).await);

    let prepare = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/prepare-checkout")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "productId": "arena-access" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(prepare.status(), StatusCode::OK);

    let checkout = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "productId": "arena-access" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(checkout.status(), StatusCode::OK);
    assert_eq!(*chain_invoice_calls.lock().unwrap(), 1);

    let payload = captured
        .lock()
        .expect("captured checkout request lock should work")
        .clone()
        .expect("fake ZamaPay API should receive checkout request");
    assert_eq!(payload["chainInvoiceId"], 0);
    assert_eq!(payload["amountMinorUnits"], 80_000_000);
}

#[tokio::test]
async fn chain_invoice_bridge_uses_project_secret_key() {
    let config = test_config("http://127.0.0.1:3001", "proj_cardforge", "zms_test_secret");
    let request = chain_invoice_request(
        &Client::new(),
        &config,
        &CreateCheckoutSessionRequest {
            amount_label: "80 cUSDT".to_string(),
            amount_minor_units: 80_000_000,
            cancel_url: None,
            chain_invoice_id: None,
            chain_tx_hash: None,
            evm_chain_id: None,
            evm_token_symbol: None,
            merchant_order_id: "cardforge-order-test".to_string(),
            metadata: Default::default(),
            note: "demo".to_string(),
            payment_rail: PaymentRail::ZamaPrivate,
            success_url: None,
            title: "Arena Access Card".to_string(),
        },
        &CheckoutQuoteResponse {
            billing: types::CheckoutBillingSnapshot {
                fee_bps: 25,
                gross_amount_minor_units: 80_000_000,
                merchant_net_minor_units: 79_800_000,
                platform_fee_minor_units: 200_000,
                plan: "growth".to_string(),
            },
            merchant_owner_wallet: "0xcAa3F62150E5813A52c329498dBEfa913B49f2de".to_string(),
        },
    )
    .build()
    .unwrap();
    assert_eq!(
        request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok()),
        Some("Bearer zms_test_secret")
    );
}

#[tokio::test]
async fn checkout_uses_server_catalog_product_amounts() {
    let captured = Arc::new(Mutex::new(None::<Value>));
    let fake_zamapay = fake_zamapay_api_with_local_chain(captured.clone()).await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zms_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = test_state(config).await;
    let response = app(state)
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "buyerWalletAddress": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de",
                        "productId": "arena-access"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let payload = captured
        .lock()
        .expect("captured checkout request lock should work")
        .clone()
        .expect("fake ZamaPay API should receive checkout request");
    assert_eq!(payload["amountMinorUnits"], 80_000_000);
    assert_eq!(payload["amountLabel"], "80 cUSDT");
    assert_eq!(payload["metadata"]["productId"], "arena-access");
    assert_eq!(
        payload["metadata"]
            .as_object()
            .expect("metadata should be an object")
            .len(),
        4
    );
}

#[tokio::test]
async fn evm_checkout_skips_private_invoice_and_sends_rail_fields() {
    let captured = Arc::new(Mutex::new(None::<Value>));
    let chain_invoice_calls = Arc::new(Mutex::new(0_u32));
    let fake_zamapay =
        fake_zamapay_api_with_local_chain_counter(captured.clone(), chain_invoice_calls.clone())
            .await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zms_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    config.payment_rail = PaymentRail::EvmErc20;
    config.evm_token_symbol = "USDT".to_string();
    let service = app(test_state(config).await);

    let checkout = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "buyerWalletAddress": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de",
                        "productId": "arena-access"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(checkout.status(), StatusCode::OK);
    let body = axum::body::to_bytes(checkout.into_body(), usize::MAX)
        .await
        .unwrap();
    let response: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(response["paymentRail"], "evm_erc20");
    assert!(response["chainInvoiceId"].is_null());
    assert_eq!(*chain_invoice_calls.lock().unwrap(), 0);

    let payload = captured
        .lock()
        .expect("captured checkout request lock should work")
        .clone()
        .expect("fake ZamaPay API should receive checkout request");
    assert_eq!(payload["paymentRail"], "evm_erc20");
    assert_eq!(payload["amountLabel"], "80 USDT");
    assert_eq!(payload["evmChainId"], 31_337);
    assert_eq!(payload["evmTokenSymbol"], "USDT");
    assert!(payload["chainInvoiceId"].is_null());
    assert!(payload["chainTxHash"].is_null());
}

#[tokio::test]
async fn webhook_receiver_accepts_valid_svix_signature() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let service = app(state);
    let payload = json!({
        "event": "invoice.fulfillment_ready",
        "checkoutSessionId": "cs_cardforge",
        "invoiceId": "cs_cardforge",
        "paymentTruth": "paid",
        "finalityStatus": "finality_safe",
        "amountLabel": "120 cUSDT",
    });
    let webhook_id = "del_cardforge";
    let timestamp = current_svix_timestamp();
    let body = payload.to_string();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);

    let accepted = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    let body = axum::body::to_bytes(accepted.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["releaseStatus"], "released");

    let fulfillment = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/fulfillment")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fulfillment.status(), StatusCode::OK);
    let body = axum::body::to_bytes(fulfillment.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["released"], true);
    assert_eq!(json["releasedCount"], 1);
    assert_eq!(json["cards"].as_array().unwrap().len(), 3);

    let rejected = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", "v1,bad")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webhook_receiver_rejects_tampered_raw_body() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let service = app(state);
    let signed_body = r#"{"event":"invoice.fulfillment_ready","checkoutSessionId":"cs_cardforge","paymentTruth":"paid","finalityStatus":"finality_safe"}"#;
    let reordered_body = r#"{"finalityStatus":"finality_safe","paymentTruth":"paid","checkoutSessionId":"cs_cardforge","event":"invoice.fulfillment_ready"}"#;
    let webhook_id = "del_cardforge_tampered";
    let timestamp = current_svix_timestamp();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, signed_body);

    let rejected = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(reordered_body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webhook_receiver_rejects_expired_svix_timestamp() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let service = app(state);
    let body = json!({ "event": "invoice.fulfillment_ready" }).to_string();
    let webhook_id = "del_cardforge_expired";
    let timestamp = expired_svix_timestamp();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);

    let rejected = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webhook_receiver_rejects_future_svix_timestamp() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let service = app(state);
    let body = json!({ "event": "invoice.fulfillment_ready" }).to_string();
    let webhook_id = "del_cardforge_future";
    let timestamp = future_svix_timestamp();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);

    let rejected = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webhook_receiver_rejects_invalid_whsec_config() {
    let mut config = test_config("http://127.0.0.1:1", "proj_cardforge", "zms_test_secret");
    config.webhook_secret = "whsec_not-base64".to_string();
    let state = test_state(config).await;
    let service = app(state);
    let body = json!({ "event": "invoice.fulfillment_ready" }).to_string();
    let webhook_id = "del_cardforge_bad_secret";
    let timestamp = current_svix_timestamp();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);

    let rejected = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn webhook_receiver_accepts_one_valid_rotated_signature() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;
    let service = app(state);
    let body = json!({
        "event": "invoice.fulfillment_ready",
        "checkoutSessionId": "cs_cardforge_rotated",
        "paymentTruth": "paid",
        "finalityStatus": "finality_safe"
    })
    .to_string();
    let webhook_id = "del_cardforge_rotated";
    let timestamp = current_svix_timestamp();
    let retired = signed_header(RETIRED_WEBHOOK_SECRET, webhook_id, &timestamp, &body);
    let current = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);
    let signatures = format!("{retired} {current}");

    let accepted = service
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signatures)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
}

#[tokio::test]
async fn fulfillment_snapshot_uses_release_order() {
    let state = test_state(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zms_test_secret",
    ))
    .await;

    assert!(
        release_from_webhook(
            &state,
            &json!({
                "event": "invoice.fulfillment_ready",
                "checkoutSessionId": "cs_z_first",
                "invoiceId": "cs_z_first",
                "paymentTruth": "paid",
                "finalityStatus": "finality_safe"
            }),
        )
        .await
        .is_ok()
    );
    assert!(
        release_from_webhook(
            &state,
            &json!({
                "event": "invoice.fulfillment_ready",
                "checkoutSessionId": "cs_a_second",
                "invoiceId": "cs_a_second",
                "paymentTruth": "paid",
                "finalityStatus": "finality_safe"
            }),
        )
        .await
        .is_ok()
    );

    let snapshot = match state.store.fulfillment_snapshot().await {
        Ok(snapshot) => snapshot,
        Err(_) => panic!("fulfillment snapshot should be available"),
    };
    assert_eq!(snapshot.released_count, 2);
    assert_eq!(
        snapshot.latest_release.unwrap().checkout_session_id,
        "cs_a_second"
    );
}

#[tokio::test]
async fn wallet_activity_records_owned_cards_after_paid_webhook() {
    let fake_zamapay = fake_zamapay_api_with_local_chain(Arc::new(Mutex::new(None))).await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zms_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = test_state(config).await;
    let service = app(state);
    let wallet = "0xC431773Fbc13B36384077847B884dE5D8dB91618";

    let checkout = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/orders/checkout")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "buyerWalletAddress": wallet,
                        "productId": "arena-access"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(checkout.status(), StatusCode::OK);

    let payload = json!({
        "event": "invoice.fulfillment_ready",
        "checkoutSessionId": "cs_cardforge",
        "invoiceId": "cs_cardforge",
        "paymentTruth": "paid",
        "finalityStatus": "finality_safe",
        "amountLabel": "80 cUSDT",
        "amountMinorUnits": 80_000_000,
        "paymentTxHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
        "createdAt": "2026-05-09T05:00:00Z"
    });
    let webhook_id = "del_cardforge_owned";
    let timestamp = current_svix_timestamp();
    let body = payload.to_string();
    let signature = signed_header(TEST_WEBHOOK_SECRET, webhook_id, &timestamp, &body);
    let accepted = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("svix-id", webhook_id)
                .header("svix-timestamp", &timestamp)
                .header("svix-signature", signature)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);

    let activity = service
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(&format!("/api/wallets/{wallet}/activity"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(activity.status(), StatusCode::OK);
    let body = axum::body::to_bytes(activity.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["ownedCards"].as_array().unwrap().len(), 1);
    assert_eq!(json["ownedCards"][0]["title"], "Arena Access Card");
    assert_eq!(json["payments"][0]["txHash"], payload["paymentTxHash"]);
}

async fn fake_zamapay_api(captured: Arc<Mutex<Option<(String, HeaderMap)>>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new()
        .route(
            "/api/dev/local-chain-invoice",
            post(|| async {
                Json(json!({
                    "chainInvoiceId": 1001,
                    "chainTxHash": "0x01",
                    "expiresAt": 1770000000,
                    "settlementAddress": "0xSettlement"
                }))
            }),
        )
        .route(
            "/api/projects/{project_id}/checkout-quote",
            post(|Path(_project_id): Path<String>| async {
                Json(json!({
                    "billing": {
                        "plan": "free",
                        "feeBps": 50,
                        "grossAmountMinorUnits": 120000000,
                        "platformFeeMinorUnits": 600000,
                        "merchantNetMinorUnits": 119400000
                    },
                    "merchantOwnerWallet": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de"
                }))
            }),
        )
        .route(
            "/api/projects/{project_id}/checkout-sessions",
            post(move |Path(project_id): Path<String>, headers: HeaderMap| {
                let captured = captured.clone();
                async move {
                    *captured.lock().unwrap() = Some((project_id, headers));
                    Json(json!({
                        "checkoutSessionId": "cs_cardforge",
                        "projectId": "proj_cardforge",
                        "environment": "local_dev",
                        "merchantOrderId": "cardforge-order",
                        "idempotencyKey": "cardforge-order",
                        "invoiceId": "cs_cardforge",
                        "chainInvoiceId": 1001,
                        "chainTxHash": "0x01",
                        "checkoutUrl": "http://127.0.0.1:3001/checkout/cs_cardforge",
                        "merchantOwnerWallet": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de",
                        "paymentRail": "zama_private",
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "billing": {
                            "plan": "free",
                            "feeBps": 50,
                            "grossAmountMinorUnits": 120000000,
                            "platformFeeMinorUnits": 600000,
                            "merchantNetMinorUnits": 119400000
                        },
                        "note": "demo",
                        "successUrl": null,
                        "cancelUrl": null,
                        "metadata": {},
                        "status": "open",
                        "createdAt": "2026-05-07T04:00:00Z",
                        "updatedAt": "2026-05-07T04:00:00Z",
                        "expiresAt": "2026-05-07T05:00:00Z"
                    }))
                }
            }),
        );

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("http://{addr}")
}

async fn fake_zamapay_api_with_local_chain(captured: Arc<Mutex<Option<Value>>>) -> String {
    fake_zamapay_api_with_local_chain_counter(captured, Arc::new(Mutex::new(0))).await
}

async fn fake_zamapay_api_with_local_chain_counter(
    captured: Arc<Mutex<Option<Value>>>,
    chain_invoice_calls: Arc<Mutex<u32>>,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new()
        .route(
            "/api/dev/local-chain-invoice",
            post({
                let chain_invoice_calls = chain_invoice_calls.clone();
                move || {
                    let chain_invoice_calls = chain_invoice_calls.clone();
                    async move {
                        let mut calls = chain_invoice_calls.lock().unwrap();
                        let chain_invoice_id = *calls as u64;
                        *calls += 1;
                        Json(json!({
                            "chainInvoiceId": chain_invoice_id,
                            "chainTxHash": format!("0x{chain_invoice_id:064x}"),
                            "expiresAt": 1770000000,
                            "settlementAddress": "0xSettlement"
                        }))
                    }
                }
            }),
        )
        .route(
            "/api/projects/{project_id}/checkout-quote",
            post(|Json(payload): Json<Value>| async move {
                let gross = payload["amountMinorUnits"].as_u64().unwrap_or(120_000_000);
                let fee = gross * 25 / 10_000;
                Json(json!({
                    "billing": {
                        "plan": "growth",
                        "feeBps": 25,
                        "grossAmountMinorUnits": gross,
                        "platformFeeMinorUnits": fee,
                        "merchantNetMinorUnits": gross - fee
                    },
                    "merchantOwnerWallet": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de"
                }))
            }),
        )
        .route(
            "/api/projects/{project_id}/checkout-sessions",
            post(move |Json(payload): Json<Value>| {
                let captured = captured.clone();
                async move {
                    let gross = payload["amountMinorUnits"].as_u64().unwrap_or(120_000_000);
                    let fee = gross * 25 / 10_000;
                    *captured.lock().unwrap() = Some(payload.clone());
                    Json(json!({
                        "checkoutSessionId": "cs_cardforge",
                        "projectId": "proj_cardforge",
                        "environment": "local_dev",
                        "merchantOrderId": payload["merchantOrderId"],
                        "idempotencyKey": payload["merchantOrderId"],
                        "invoiceId": "cs_cardforge",
                        "chainInvoiceId": payload["chainInvoiceId"],
                        "chainTxHash": payload["chainTxHash"],
                        "checkoutUrl": "http://127.0.0.1:3001/checkout/cs_cardforge",
                        "merchantOwnerWallet": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de",
                        "paymentRail": payload.get("paymentRail").cloned().unwrap_or_else(|| json!("zama_private")),
                        "title": payload["title"],
                        "amountLabel": payload["amountLabel"],
                        "amountMinorUnits": gross,
                        "billing": {
                            "plan": "growth",
                            "feeBps": 25,
                            "grossAmountMinorUnits": gross,
                            "platformFeeMinorUnits": fee,
                            "merchantNetMinorUnits": gross - fee
                        },
                        "note": "demo",
                        "successUrl": null,
                        "cancelUrl": null,
                        "metadata": {},
                        "status": "open",
                        "createdAt": "2026-05-07T04:00:00Z",
                        "updatedAt": "2026-05-07T04:00:00Z",
                        "expiresAt": "2026-05-07T05:00:00Z"
                    }))
                }
            }),
        );

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("http://{addr}")
}

fn test_config(api_url: &str, project_id: &str, secret_key: &str) -> Config {
    Config {
        allowed_origins: Vec::new(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        database_url: test_database_url(),
        login_url: "http://127.0.0.1:3001/login".to_string(),
        local_chain_invoice_api_url: api_url.to_string(),
        zamapay_api_url: api_url.to_string(),
        zamapay_console_url: "http://127.0.0.1:3001/merchant".to_string(),
        project_secret_key: secret_key.to_string(),
        merchant_label: "CardForge Demo Store".to_string(),
        project_id: project_id.to_string(),
        store_key: format!("test-{}", Uuid::new_v4().simple()),
        webhook_endpoint: "http://127.0.0.1:8092/api/zamapay/webhook".to_string(),
        webhook_endpoint_id: "whend_test".to_string(),
        webhook_secret: TEST_WEBHOOK_SECRET.to_string(),
        payment_rail: PaymentRail::ZamaPrivate,
        evm_chain_id: 31_337,
        evm_token_symbol: "USDT".to_string(),
    }
}

async fn test_state(config: Config) -> AppState {
    let _guard = TEST_STATE_INIT.lock().await;
    AppState::new(config).await.unwrap()
}

fn test_database_url() -> String {
    std::env::var("CARDFORGE_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("CARDFORGE_DATABASE_URL"))
        .unwrap_or_else(|_| "postgres://zamapay:zamapay@127.0.0.1:5432/cardforge".to_string())
}

fn current_svix_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string()
}

fn expired_svix_timestamp() -> String {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS as u64
        - 1)
    .to_string()
}

fn future_svix_timestamp() -> String {
    (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS as u64
        + 1)
    .to_string()
}

fn signed_header(secret: &str, webhook_id: &str, timestamp: &str, body: &str) -> String {
    sign_webhook_payload_with_timestamp(secret, webhook_id, timestamp, body)
}
