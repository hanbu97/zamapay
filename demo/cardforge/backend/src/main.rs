use std::{
    env,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use ethers_core::utils::keccak256;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;
use tower_http::{cors::AllowOrigin, cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8092";
const DEFAULT_API_URL: &str = "http://127.0.0.1:8080";
const DEFAULT_CONSOLE_URL: &str = "http://127.0.0.1:3001/merchant";
const DEFAULT_LOGIN_URL: &str = "http://127.0.0.1:3001/login";
const DEFAULT_MERCHANT_LABEL: &str = "CardForge Demo Store";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://127.0.0.1:8092/api/mermer-pay/webhook";

#[derive(Clone)]
struct AppState {
    client: Client,
    config: Arc<Config>,
    webhooks: Arc<Mutex<Vec<WebhookReceipt>>>,
}

#[derive(Clone)]
struct Config {
    bind_addr: SocketAddr,
    login_url: String,
    mermer_api_url: String,
    mermer_console_url: String,
    project_api_key: String,
    merchant_label: String,
    project_id: String,
    webhook_endpoint: String,
    webhook_secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    amount_label: String,
    amount_minor_units: u64,
    codes: Vec<String>,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorefrontResponse {
    merchant_label: String,
    mermer_console_url: String,
    mermer_login_url: String,
    product: Product,
    project_id: String,
    webhook_endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutResponse {
    chain_invoice_id: u64,
    checkout_url: String,
    checkout_session_id: String,
    invoice_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateCheckoutSessionRequest {
    amount_label: String,
    amount_minor_units: u64,
    cancel_url: Option<String>,
    merchant_order_id: String,
    metadata: std::collections::BTreeMap<String, String>,
    note: String,
    success_url: Option<String>,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MermerCheckoutSessionResponse {
    chain_invoice_id: u64,
    checkout_session_id: String,
    checkout_url: String,
    invoice_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookReceipt {
    id: Option<String>,
    signature: Option<String>,
    payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookAck {
    received: bool,
    received_event_count: usize,
    release_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookLog {
    events: Vec<WebhookReceipt>,
    received_event_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    login_url: Option<String>,
    message: String,
}

struct ApiError {
    body: ErrorBody,
    status: StatusCode,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let bind_addr = config.bind_addr;
    let state = AppState::new(config);
    let listener = TcpListener::bind(bind_addr).await?;

    println!("CardForge backend listening on http://{bind_addr}");
    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/storefront", get(storefront))
        .route("/api/orders/checkout", post(create_checkout))
        .route("/api/mermer-pay/webhook", post(receive_webhook))
        .route("/api/mermer-pay/webhooks", get(webhook_log))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors())
}

impl AppState {
    fn new(config: Config) -> Self {
        Self {
            client: Client::new(),
            config: Arc::new(config),
            webhooks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Self {
            bind_addr: env_value("CARDFORGE_BACKEND_BIND", DEFAULT_BIND_ADDR).parse()?,
            login_url: env_value("MERMER_PAY_LOGIN_URL", DEFAULT_LOGIN_URL),
            mermer_api_url: clean_base_url(env_value("MERMER_PAY_API_URL", DEFAULT_API_URL)),
            mermer_console_url: clean_base_url(env_value(
                "MERMER_PAY_CONSOLE_URL",
                DEFAULT_CONSOLE_URL,
            )),
            project_api_key: required_env("MERMER_PAY_API_KEY")?,
            merchant_label: env_value("CARDFORGE_MERCHANT_LABEL", DEFAULT_MERCHANT_LABEL),
            project_id: required_env("MERMER_PAY_PROJECT_ID")?,
            webhook_endpoint: env_value("CARDFORGE_WEBHOOK_ENDPOINT", DEFAULT_WEBHOOK_ENDPOINT),
            webhook_secret: required_env("MERMER_PAY_WEBHOOK_SECRET")?,
        })
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn storefront(State(state): State<AppState>) -> Json<StorefrontResponse> {
    Json(StorefrontResponse {
        merchant_label: state.config.merchant_label.clone(),
        mermer_console_url: state.config.mermer_console_url.clone(),
        mermer_login_url: state.config.login_url.clone(),
        product: product(),
        project_id: state.config.project_id.clone(),
        webhook_endpoint: state.config.webhook_endpoint.clone(),
    })
}

async fn create_checkout(
    State(state): State<AppState>,
) -> Result<Json<CheckoutResponse>, ApiError> {
    let checkout = create_mermer_checkout_session(&state).await?;

    Ok(Json(CheckoutResponse {
        chain_invoice_id: checkout.chain_invoice_id,
        checkout_session_id: checkout.checkout_session_id,
        checkout_url: checkout.checkout_url,
        invoice_id: checkout.invoice_id,
    }))
}

async fn receive_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<WebhookAck>, ApiError> {
    verify_webhook_signature(&state.config, &headers, &payload)?;
    let receipt = WebhookReceipt {
        id: header_text(&headers, "x-mermer-webhook-id"),
        signature: header_text(&headers, "x-mermer-webhook-signature"),
        payload,
    };
    let received_event_count = push_webhook(&state, receipt)?;

    Ok(Json(WebhookAck {
        received: true,
        received_event_count,
        release_status: "recorded",
    }))
}

async fn webhook_log(State(state): State<AppState>) -> Result<Json<WebhookLog>, ApiError> {
    let events = webhooks(&state)?;

    Ok(Json(WebhookLog {
        received_event_count: events.len(),
        events,
    }))
}

async fn create_mermer_checkout_session(
    state: &AppState,
) -> Result<MermerCheckoutSessionResponse, ApiError> {
    let payload = checkout_payload();
    let response = state
        .client
        .post(format!(
            "{}/api/projects/{}/checkout-sessions",
            state.config.mermer_api_url, state.config.project_id
        ))
        .bearer_auth(&state.config.project_api_key)
        .header("idempotency-key", &payload.merchant_order_id)
        .json(&payload)
        .send()
        .await
        .map_err(ApiError::upstream_unreachable)?;
    let status = response.status();

    if status.as_u16() == StatusCode::UNAUTHORIZED.as_u16() {
        return Err(ApiError::project_auth_failed());
    }

    if !status.is_success() {
        return Err(ApiError::upstream_rejected(status.as_u16(), response).await);
    }

    let checkout: MermerCheckoutSessionResponse =
        response.json().await.map_err(ApiError::bad_upstream_json)?;
    if checkout.chain_invoice_id == 0 {
        return Err(ApiError::bad_upstream_shape(
            "Mermer Pay returned a checkout without chain invoice authority.",
        ));
    }

    Ok(checkout)
}

fn checkout_payload() -> CreateCheckoutSessionRequest {
    let order_id = format!("cardforge-{}", Uuid::new_v4().simple());

    CreateCheckoutSessionRequest {
        amount_label: "120 cUSDT".to_string(),
        amount_minor_units: 120_000_000,
        cancel_url: None,
        merchant_order_id: order_id,
        metadata: std::collections::BTreeMap::new(),
        note: "Three CardForge demo codes release after Mermer Pay reports finality-safe payment."
            .to_string(),
        success_url: None,
        title: "CardForge prepaid card bundle".to_string(),
    }
}

fn product() -> Product {
    Product {
        amount_label: "120 cUSDT".to_string(),
        amount_minor_units: 120_000_000,
        codes: vec![
            "SEA prepaid code".to_string(),
            "Game wallet code".to_string(),
            "Instant access code".to_string(),
        ],
        title: "Prepaid card bundle".to_string(),
    }
}

fn push_webhook(state: &AppState, receipt: WebhookReceipt) -> Result<usize, ApiError> {
    let mut webhooks = state
        .webhooks
        .lock()
        .map_err(|_| ApiError::internal("webhook store is unavailable"))?;

    webhooks.push(receipt);
    Ok(webhooks.len())
}

fn webhooks(state: &AppState) -> Result<Vec<WebhookReceipt>, ApiError> {
    state
        .webhooks
        .lock()
        .map(|events| events.clone())
        .map_err(|_| ApiError::internal("webhook store is unavailable"))
}

fn verify_webhook_signature(
    config: &Config,
    headers: &HeaderMap,
    payload: &Value,
) -> Result<(), ApiError> {
    let webhook_id = required_header(headers, "x-mermer-webhook-id")?;
    let timestamp = required_header(headers, "x-mermer-webhook-timestamp")?;
    let provided = required_header(headers, "x-mermer-webhook-signature")?;
    let algorithm = required_header(headers, "x-mermer-webhook-algorithm")?;

    if algorithm != "keccak256.secret_prefix.v1" {
        return Err(ApiError::invalid_webhook_signature(
            "Unsupported Mermer Pay webhook signature algorithm.",
        ));
    }

    let canonical_body = serde_json::to_string(payload)
        .map_err(|_| ApiError::internal("webhook payload cannot be canonicalized"))?;
    let signature_base = format!("{webhook_id}.{timestamp}.{canonical_body}");
    let expected = format!(
        "v1={}",
        keyed_digest(&config.webhook_secret, &signature_base)
    );

    if provided != expected {
        return Err(ApiError::invalid_webhook_signature(
            "Mermer Pay webhook signature mismatch.",
        ));
    }

    Ok(())
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiError::invalid_webhook_signature(
            "Mermer Pay webhook signature headers are incomplete.",
        ))
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            origin.as_bytes().starts_with(b"http://127.0.0.1:")
                || origin.as_bytes().starts_with(b"http://localhost:")
        }))
}

fn env_value(key: &str, fallback: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn required_env(key: &'static str) -> Result<String, ConfigError> {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError(key))
}

fn clean_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

fn keyed_digest(secret: &str, message: &str) -> String {
    let digest = keccak256(format!("{secret}.{message}").as_bytes());
    format!("0x{}", lower_hex(&digest))
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

#[derive(Debug)]
struct ConfigError(&'static str);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "required CardForge environment variable {} is missing",
            self.0
        )
    }
}

impl std::error::Error for ConfigError {}

impl ApiError {
    fn project_auth_failed() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "mermer_project_auth_failed",
            "CardForge backend rejected the configured Mermer Pay project API key.",
            None,
        )
    }

    fn upstream_unreachable(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("Mermer Pay API is unreachable: {error}"),
            None,
        )
    }

    async fn upstream_rejected(status: u16, response: reqwest::Response) -> Self {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("Mermer Pay API rejected the checkout with status {status}.")
        } else {
            body
        };

        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    fn bad_upstream_json(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("Mermer Pay API returned an invalid checkout response: {error}"),
            None,
        )
    }

    fn bad_upstream_shape(message: &str) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    fn invalid_webhook_signature(message: &str) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "invalid_webhook_signature",
            message,
            None,
        )
    }

    fn internal(message: &str) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            message,
            None,
        )
    }

    fn new(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        login_url: Option<String>,
    ) -> Self {
        Self {
            body: ErrorBody {
                code,
                login_url,
                message: message.into(),
            },
            status,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        body::Body,
        extract::Path,
        http::{Request, header},
    };
    use serde_json::json;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn checkout_uses_project_api_key_and_drops_browser_cookie() {
        let captured = Arc::new(Mutex::new(None::<(String, HeaderMap)>));
        let fake_mermer = fake_mermer_api(captured.clone()).await;
        let state = AppState::new(test_config(
            &fake_mermer,
            "proj_cardforge",
            "mmp_test_secret",
        ));
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders/checkout")
                    .header(header::COOKIE, "mermer_session=must-not-forward")
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

        let (project_id, headers) = captured
            .lock()
            .expect("captured request lock should work")
            .clone()
            .expect("fake Mermer API should receive checkout request");
        assert_eq!(project_id, "proj_cardforge");
        assert_eq!(
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer mmp_test_secret")
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
    async fn webhook_receiver_requires_mermer_signature() {
        let state = AppState::new(test_config(
            "http://127.0.0.1:1",
            "proj_cardforge",
            "mmp_test_secret",
        ));
        let service = app(state);
        let payload = json!({
            "event": "invoice.fulfillment_ready",
            "checkoutSessionId": "cs_cardforge",
        });
        let webhook_id = "del_cardforge";
        let timestamp = "2026-05-07T04:00:00Z";
        let signature = signed_header("whsec_test", webhook_id, timestamp, &payload);

        let accepted = service
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mermer-pay/webhook")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-mermer-webhook-id", webhook_id)
                    .header("x-mermer-webhook-timestamp", timestamp)
                    .header("x-mermer-webhook-signature", signature)
                    .header("x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);

        let rejected = service
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mermer-pay/webhook")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-mermer-webhook-id", webhook_id)
                    .header("x-mermer-webhook-timestamp", timestamp)
                    .header("x-mermer-webhook-signature", "v1=bad")
                    .header("x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    }

    async fn fake_mermer_api(captured: Arc<Mutex<Option<(String, HeaderMap)>>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route(
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
                        "title": "CardForge prepaid card bundle",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
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
            login_url: "http://127.0.0.1:3001/login".to_string(),
            mermer_api_url: api_url.to_string(),
            mermer_console_url: "http://127.0.0.1:3001/merchant".to_string(),
            project_api_key: api_key.to_string(),
            merchant_label: "CardForge Demo Store".to_string(),
            project_id: project_id.to_string(),
            webhook_endpoint: "http://127.0.0.1:8092/api/mermer-pay/webhook".to_string(),
            webhook_secret: "whsec_test".to_string(),
        }
    }

    fn signed_header(secret: &str, webhook_id: &str, timestamp: &str, payload: &Value) -> String {
        let canonical_body = serde_json::to_string(payload).unwrap();
        let base = format!("{webhook_id}.{timestamp}.{canonical_body}");
        format!("v1={}", keyed_digest(secret, &base))
    }
}
