use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use ethers_core::utils::keccak256;
use serde_json::json;
use tower::ServiceExt;

use api::{AppState, app};

#[tokio::test]
async fn operator_webhook_delivery_retries_dead_letters_and_recovers() {
    let state = AppState::new();
    let seeded_session = state.issue_dev_session("0x0000000000000000000000000000000000000009");
    let app = app(state);

    create_invoice(
        &app,
        &seeded_session.session_id.to_string(),
        11,
        "webhook-ref-0011",
    )
    .await;
    project_paid(&app, 11, "0xpaid-webhook").await;
    let finality_safe = project_confirmations(&app, 11, 2).await;
    assert_eq!(finality_safe["snapshot"]["finalityStatus"], "finality_safe");
    assert_eq!(finality_safe["webhook"]["status"], "pending");

    let unsigned_dispatch = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/chain-invoices/11/webhook-dispatch")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unsigned_dispatch.status(), StatusCode::UNAUTHORIZED);

    let signed_dispatch = request_json(
        &app,
        Request::builder()
            .method(Method::GET)
            .uri("/api/operator/chain-invoices/11/webhook-dispatch")
            .header("x-operator-key", "local-operator-dev-key")
            .body(Body::empty())
            .unwrap(),
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        signed_dispatch["endpoint"],
        "https://merchant.example/webhooks/mermer-pay"
    );
    assert_eq!(
        signed_dispatch["payload"]["event"],
        "invoice.fulfillment_ready"
    );
    assert_eq!(signed_dispatch["payload"]["invoiceId"], "webhook-ref-0011");
    assert_eq!(signed_dispatch["payload"]["chainInvoiceId"], 11);
    assert_eq!(
        signed_dispatch["payload"]["paymentTxHash"],
        "0xpaid-webhook"
    );
    assert_eq!(signed_dispatch["payload"]["paymentTruth"], "paid");
    assert_eq!(
        signed_dispatch["payload"]["finalityStatus"],
        "finality_safe"
    );
    assert_eq!(signed_dispatch["payload"]["webhookAttemptCount"], 0);

    let webhook_id = signed_dispatch["headers"]["x-mermer-webhook-id"]
        .as_str()
        .expect("webhook id should be present");
    let timestamp = signed_dispatch["headers"]["x-mermer-webhook-timestamp"]
        .as_str()
        .expect("webhook timestamp should be present");
    let canonical_body = signed_dispatch["canonicalBody"]
        .as_str()
        .expect("canonical body should be present");
    let signature_base = signed_dispatch["signatureBase"]
        .as_str()
        .expect("signature base should be present");
    assert_eq!(
        signature_base,
        format!("{webhook_id}.{timestamp}.{canonical_body}")
    );
    assert_eq!(
        signed_dispatch["headers"]["x-mermer-webhook-signature"],
        expected_webhook_signature(signature_base)
    );

    let invalid_max_attempts = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/operator/chain-invoices/11/webhook-delivery")
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({ "outcome": "failed", "maxAttempts": 0 }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(invalid_max_attempts.status(), StatusCode::BAD_REQUEST);

    let first_failure =
        post_operator_webhook(&app, 11, json!({ "outcome": "failed", "maxAttempts": 2 })).await;
    assert_eq!(first_failure["webhook"]["status"], "retry_scheduled");
    assert_eq!(first_failure["webhook"]["attemptCount"], 1);
    assert_eq!(first_failure["webhook"]["nextRetryAfterSeconds"], 30);

    let second_failure =
        post_operator_webhook(&app, 11, json!({ "outcome": "failed", "maxAttempts": 2 })).await;
    assert_eq!(second_failure["webhook"]["status"], "dead_letter");
    assert_eq!(second_failure["webhook"]["attemptCount"], 2);
    assert!(second_failure["webhook"]["nextRetryAfterSeconds"].is_null());

    let diagnostics = operator_diagnostics(&app).await;
    assert_eq!(diagnostics["failedWebhooks"], 1);
    assert_eq!(diagnostics["operatorActionRequired"], true);

    let delivered = post_operator_webhook(&app, 11, json!({ "outcome": "delivered" })).await;
    assert_eq!(delivered["webhook"]["status"], "delivered");

    let duplicate_delivered =
        post_operator_webhook(&app, 11, json!({ "outcome": "delivered" })).await;
    assert_eq!(duplicate_delivered["webhook"]["status"], "delivered");
    assert_eq!(duplicate_delivered["webhook"]["attemptCount"], 2);

    let delivered_dispatch = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/operator/chain-invoices/11/webhook-dispatch")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(delivered_dispatch.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn merchant_decrypt_request_rejects_duplicates_and_gateway_replay() {
    let state = AppState::new();
    let seeded_session = state.issue_dev_session("0x0000000000000000000000000000000000000009");
    let session_cookie = seeded_session.session_id.to_string();
    let app = app(state);

    create_invoice(&app, &session_cookie, 12, "decrypt-ref-0012").await;

    let not_paid = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices/decrypt-ref-0012/decrypt-request")
                .header("cookie", format!("mermer_session={session_cookie}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(not_paid.status(), StatusCode::CONFLICT);

    project_paid(&app, 12, "0xpaid-decrypt").await;
    let requested = request_json(
        &app,
        Request::builder()
            .method(Method::POST)
            .uri("/api/invoices/decrypt-ref-0012/decrypt-request")
            .header("cookie", format!("mermer_session={session_cookie}"))
            .body(Body::empty())
            .unwrap(),
        StatusCode::OK,
    )
    .await;
    assert_eq!(requested["snapshot"]["decryptJobStatus"], "requested");
    let request_id = requested["decryptRequest"]["requestId"]
        .as_str()
        .expect("decrypt request id should exist")
        .to_string();
    assert!(request_id.starts_with("dec_"));

    let duplicate = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices/decrypt-ref-0012/decrypt-request")
                .header("cookie", format!("mermer_session={session_cookie}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);

    let unauthorized_callback = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/decrypt-requests/{request_id}/callback"
                ))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "outcome": "completed", "callbackSender": "local-gateway" })
                        .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized_callback.status(), StatusCode::UNAUTHORIZED);

    let completed = gateway_callback(
        &app,
        &request_id,
        json!({ "outcome": "completed", "callbackSender": "local-gateway" }),
    )
    .await;
    assert_eq!(completed["snapshot"]["decryptJobStatus"], "completed");
    assert_eq!(
        completed["decryptRequest"]["callbackSender"],
        "local-gateway"
    );
    assert_eq!(completed["decryptRequest"]["replayedCallbackCount"], 0);

    let replay = gateway_callback(
        &app,
        &request_id,
        json!({ "outcome": "completed", "callbackSender": "local-gateway" }),
    )
    .await;
    assert_eq!(replay["snapshot"]["decryptJobStatus"], "completed");
    assert_eq!(replay["decryptRequest"]["replayedCallbackCount"], 1);

    let diagnostics = operator_diagnostics(&app).await;
    assert_eq!(diagnostics["decryptPendingGuardTrips"], 1);
    assert_eq!(diagnostics["pendingDecryptJobs"], 0);
}

async fn create_invoice(
    app: &axum::Router,
    session_cookie: &str,
    chain_invoice_id: u64,
    external_ref: &str,
) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/invoices")
                .header("content-type", "application/json")
                .header("cookie", format!("mermer_session={session_cookie}"))
                .body(Body::from(
                    json!({
                        "title": "Operator reliability invoice",
                        "amountLabel": "101 cUSDT",
                        "amountMinorUnits": 101000000,
                        "note": "Operator reliability target",
                        "externalRef": external_ref,
                        "chainInvoiceId": chain_invoice_id,
                        "chainTxHash": "0xcreate"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

async fn project_paid(app: &axum::Router, chain_invoice_id: u64, payment_tx_hash: &str) {
    let response = app
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
                        "paymentTxHash": payment_tx_hash,
                        "payerAddress": "0x0000000000000000000000000000000000000004"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

async fn project_confirmations(
    app: &axum::Router,
    chain_invoice_id: u64,
    confirmations: u64,
) -> serde_json::Value {
    request_json(
        app,
        Request::builder()
            .method(Method::POST)
            .uri(format!(
                "/api/operator/chain-invoices/{chain_invoice_id}/confirmations"
            ))
            .header("content-type", "application/json")
            .header("x-operator-key", "local-operator-dev-key")
            .body(Body::from(
                json!({ "confirmations": confirmations, "finalityThreshold": 2 }).to_string(),
            ))
            .unwrap(),
        StatusCode::OK,
    )
    .await
}

async fn post_operator_webhook(
    app: &axum::Router,
    chain_invoice_id: u64,
    payload: serde_json::Value,
) -> serde_json::Value {
    request_json(
        app,
        Request::builder()
            .method(Method::POST)
            .uri(format!(
                "/api/operator/chain-invoices/{chain_invoice_id}/webhook-delivery"
            ))
            .header("content-type", "application/json")
            .header("x-operator-key", "local-operator-dev-key")
            .body(Body::from(payload.to_string()))
            .unwrap(),
        StatusCode::OK,
    )
    .await
}

async fn gateway_callback(
    app: &axum::Router,
    request_id: &str,
    payload: serde_json::Value,
) -> serde_json::Value {
    request_json(
        app,
        Request::builder()
            .method(Method::POST)
            .uri(format!(
                "/api/operator/decrypt-requests/{request_id}/callback"
            ))
            .header("content-type", "application/json")
            .header("x-zama-gateway-key", "local-zama-gateway-dev-key")
            .body(Body::from(payload.to_string()))
            .unwrap(),
        StatusCode::OK,
    )
    .await
}

async fn operator_diagnostics(app: &axum::Router) -> serde_json::Value {
    request_json(
        app,
        Request::builder()
            .method(Method::GET)
            .uri("/api/operator/diagnostics")
            .header("x-operator-key", "local-operator-dev-key")
            .body(Body::empty())
            .unwrap(),
        StatusCode::OK,
    )
    .await
}

async fn request_json(
    app: &axum::Router,
    request: Request<Body>,
    expected_status: StatusCode,
) -> serde_json::Value {
    let response = app.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), expected_status);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn expected_webhook_signature(signature_base: &str) -> String {
    let secret = std::env::var("MERMER_WEBHOOK_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "local-webhook-dev-secret".to_string());
    format!(
        "v1=0x{}",
        lower_hex(&keccak256(format!("{secret}.{signature_base}").as_bytes()))
    )
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
}
