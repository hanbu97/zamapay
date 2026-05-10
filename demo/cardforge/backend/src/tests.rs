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

use super::*;

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
async fn checkout_uses_project_api_key_and_drops_browser_cookie() {
    let captured = Arc::new(Mutex::new(None::<(String, HeaderMap)>));
    let fake_zamapay = fake_zamapay_api(captured.clone()).await;
    let state = AppState::new(test_config(
        &fake_zamapay,
        "proj_cardforge",
        "zmp_test_secret",
    ))
    .await
    .unwrap();
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
        Some("Bearer zmp_test_secret")
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
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zmp_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = AppState::new(config).await.unwrap();
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
    assert_eq!(payload["chainTxHash"], "0xabc");
}

#[tokio::test]
async fn checkout_uses_server_catalog_product_amounts() {
    let captured = Arc::new(Mutex::new(None::<Value>));
    let fake_zamapay = fake_zamapay_api_with_local_chain(captured.clone()).await;
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zmp_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = AppState::new(config).await.unwrap();
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
        3
    );
}

#[tokio::test]
async fn webhook_receiver_requires_zamapay_signature() {
    let state = AppState::new(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zmp_test_secret",
    ))
    .await
    .unwrap();
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
    let timestamp = "2026-05-07T04:00:00Z";
    let signature = signed_header("whsec_test", webhook_id, timestamp, &payload);

    let accepted = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-zamapay-webhook-id", webhook_id)
                .header("x-zamapay-webhook-timestamp", timestamp)
                .header("x-zamapay-webhook-signature", signature)
                .header("x-zamapay-webhook-algorithm", "keccak256.secret_prefix.v1")
                .body(Body::from(payload.to_string()))
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
                .header("x-zamapay-webhook-id", webhook_id)
                .header("x-zamapay-webhook-timestamp", timestamp)
                .header("x-zamapay-webhook-signature", "v1=bad")
                .header("x-zamapay-webhook-algorithm", "keccak256.secret_prefix.v1")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn fulfillment_snapshot_uses_release_order() {
    let state = AppState::new(test_config(
        "http://127.0.0.1:1",
        "proj_cardforge",
        "zmp_test_secret",
    ))
    .await
    .unwrap();

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
    let mut config = test_config(&fake_zamapay, "proj_cardforge", "zmp_test_secret");
    config.local_chain_invoice_api_url = fake_zamapay;
    let state = AppState::new(config).await.unwrap();
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
    let timestamp = "2026-05-09T05:00:00Z";
    let signature = signed_header("whsec_test", webhook_id, timestamp, &payload);
    let accepted = service
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/zamapay/webhook")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-zamapay-webhook-id", webhook_id)
                .header("x-zamapay-webhook-timestamp", timestamp)
                .header("x-zamapay-webhook-signature", signature)
                .header("x-zamapay-webhook-algorithm", "keccak256.secret_prefix.v1")
                .body(Body::from(payload.to_string()))
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
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new()
        .route(
            "/api/dev/local-chain-invoice",
            post(|| async {
                Json(json!({
                    "chainInvoiceId": 0,
                    "chainTxHash": "0xabc",
                    "expiresAt": 1770000000,
                    "settlementAddress": "0xSettlement"
                }))
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

fn test_config(api_url: &str, project_id: &str, api_key: &str) -> Config {
    Config {
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        database_url: test_database_url(),
        login_url: "http://127.0.0.1:3001/login".to_string(),
        local_chain_invoice_api_url: api_url.to_string(),
        zamapay_api_url: api_url.to_string(),
        zamapay_console_url: "http://127.0.0.1:3001/merchant".to_string(),
        project_api_key: api_key.to_string(),
        merchant_label: "CardForge Demo Store".to_string(),
        project_id: project_id.to_string(),
        store_key: format!("test-{}", Uuid::new_v4().simple()),
        webhook_endpoint: "http://127.0.0.1:8092/api/zamapay/webhook".to_string(),
        webhook_secret: "whsec_test".to_string(),
    }
}

fn test_database_url() -> String {
    std::env::var("CARDFORGE_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("CARDFORGE_DATABASE_URL"))
        .unwrap_or_else(|_| "postgres://zamapay:zamapay@127.0.0.1:5432/cardforge".to_string())
}

fn signed_header(secret: &str, webhook_id: &str, timestamp: &str, payload: &Value) -> String {
    let canonical_body = serde_json::to_string(payload).unwrap();
    let base = format!("{webhook_id}.{timestamp}.{canonical_body}");
    format!("v1={}", keyed_digest(secret, &base))
}
