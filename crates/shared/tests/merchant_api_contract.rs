use chrono::{TimeZone, Utc};
use serde_json::Value;
use shared::{
    CheckoutSession, CheckoutSessionResponse, CreateCheckoutSessionRequest,
    MerchantApiErrorEnvelope, MerchantApiErrorType, PaymentRail, ProjectSecretBootstrapResponse,
    WebhookVerificationError, ZAMAPAY_API_VERSION_HEADER, ZAMAPAY_PREVIEW_API_VERSION,
    verify_webhook_payload_result, webhook_payload_sha256,
};

const CONTRACT: &str = include_str!("../../../fixtures/merchant-api/contract-v1.json");

#[test]
fn fixture_version_matches_preview_boundary() {
    let contract = fixture();

    assert_eq!(
        contract["apiVersion"].as_str().unwrap(),
        ZAMAPAY_PREVIEW_API_VERSION
    );
    assert_eq!(
        contract["headers"]["apiVersion"].as_str().unwrap(),
        ZAMAPAY_API_VERSION_HEADER
    );
}

#[test]
fn bootstrap_and_checkout_fixtures_match_shared_dtos() {
    let contract = fixture();

    let bootstrap: ProjectSecretBootstrapResponse = from_pointer(&contract, "/bootstrap/response");
    assert_eq!(bootstrap.project_id, "proj_sdk_fixture");
    assert!(bootstrap.webhook_secret.unwrap().starts_with("whsec_"));

    let private_request: CreateCheckoutSessionRequest =
        from_pointer(&contract, "/checkoutSessions/createZamaPrivate/request");
    assert_eq!(private_request.payment_rail, Some(PaymentRail::ZamaPrivate));
    assert_eq!(private_request.chain_invoice_id, Some(42));

    let private_response: CheckoutSessionResponse =
        from_pointer(&contract, "/checkoutSessions/createZamaPrivate/response");
    assert_eq!(
        private_response.session.payment_rail,
        PaymentRail::ZamaPrivate
    );
    assert!(private_response.evm_payment_intent.is_none());

    let private_retrieve: CheckoutSession = from_pointer(
        &contract,
        "/checkoutSessions/createZamaPrivate/retrieveResponse",
    );
    assert_eq!(private_retrieve.payment_rail, PaymentRail::ZamaPrivate);

    let evm_request: CreateCheckoutSessionRequest =
        from_pointer(&contract, "/checkoutSessions/createEvmErc20/request");
    assert_eq!(evm_request.payment_rail, Some(PaymentRail::EvmErc20));
    assert_eq!(evm_request.evm_chain_id, Some(31337));
    assert_eq!(evm_request.evm_token_symbol.as_deref(), Some("USDT"));

    let evm_response: CheckoutSessionResponse =
        from_pointer(&contract, "/checkoutSessions/createEvmErc20/response");
    assert_eq!(evm_response.session.payment_rail, PaymentRail::EvmErc20);
    assert!(evm_response.evm_payment_intent.is_some());

    let evm_retrieve: CheckoutSession = from_pointer(
        &contract,
        "/checkoutSessions/createEvmErc20/retrieveResponse",
    );
    assert_eq!(evm_retrieve.payment_rail, PaymentRail::EvmErc20);
}

#[test]
fn error_envelopes_are_typed_sdk_contracts() {
    let contract = fixture();

    let auth: MerchantApiErrorEnvelope =
        from_pointer(&contract, "/errorEnvelopes/authentication/body");
    assert_eq!(auth.error.kind, MerchantApiErrorType::AuthenticationError);
    assert_eq!(auth.error.code, "missing_bearer_project_secret");

    let idempotency: MerchantApiErrorEnvelope =
        from_pointer(&contract, "/errorEnvelopes/idempotency/body");
    assert_eq!(
        idempotency.error.kind,
        MerchantApiErrorType::InvalidRequestError
    );
    assert_eq!(idempotency.error.code, "missing_idempotency_key");
}

#[test]
fn webhook_vectors_match_rust_verifier_protocol() {
    let contract = fixture();
    let webhooks = &contract["webhooks"];
    let current_secret = webhooks["currentSecret"].as_str().unwrap();
    let retired_secret = webhooks["retiredSecret"].as_str().unwrap();
    let valid = &webhooks["valid"];
    let message_id = valid["messageId"].as_str().unwrap();
    let timestamp = valid["timestamp"].as_str().unwrap();
    let raw_body = valid["rawBody"].as_str().unwrap();
    let signature = valid["headers"]["svix-signature"].as_str().unwrap();
    let now = unix(valid["nowUnixSeconds"].as_i64().unwrap());

    assert_eq!(
        webhook_payload_sha256(raw_body),
        valid["rawPayloadSha256"].as_str().unwrap()
    );
    verify_webhook_payload_result(
        current_secret,
        message_id,
        timestamp,
        signature,
        raw_body,
        now,
    )
    .unwrap();

    let tampered_body = webhooks["tamperedBody"]["rawBody"].as_str().unwrap();
    assert_eq!(
        verify_webhook_payload_result(
            current_secret,
            message_id,
            timestamp,
            signature,
            tampered_body,
            now,
        ),
        Err(WebhookVerificationError::InvalidSignature)
    );

    assert_eq!(
        verify_webhook_payload_result(
            current_secret,
            message_id,
            timestamp,
            signature,
            raw_body,
            unix(webhooks["expired"]["nowUnixSeconds"].as_i64().unwrap()),
        ),
        Err(WebhookVerificationError::TimestampTooOld)
    );

    assert_eq!(
        verify_webhook_payload_result(
            webhooks["invalidSecret"]["secret"].as_str().unwrap(),
            message_id,
            timestamp,
            signature,
            raw_body,
            now,
        ),
        Err(WebhookVerificationError::InvalidSecret)
    );

    let rotation_signature = webhooks["rotation"]["headers"]["svix-signature"]
        .as_str()
        .unwrap();
    verify_webhook_payload_result(
        current_secret,
        message_id,
        timestamp,
        rotation_signature,
        raw_body,
        now,
    )
    .unwrap();
    verify_webhook_payload_result(
        retired_secret,
        message_id,
        timestamp,
        rotation_signature,
        raw_body,
        now,
    )
    .unwrap();
}

fn fixture() -> Value {
    serde_json::from_str(CONTRACT).unwrap()
}

fn unix(seconds: i64) -> chrono::DateTime<Utc> {
    Utc.timestamp_opt(seconds, 0).single().unwrap()
}

fn from_pointer<T>(fixture: &Value, pointer: &str) -> T
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(fixture.pointer(pointer).unwrap().clone()).unwrap()
}
