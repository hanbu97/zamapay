use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    routing::{get, post},
};
use ethers_core::utils::keccak256;
use reqwest::Client;
use sea_orm::DbErr;
use serde_json::Value;
use tower_http::{cors::AllowOrigin, cors::CorsLayer, trace::TraceLayer};

mod catalog;
mod config;
mod error;
mod process;
mod store;
#[cfg(test)]
mod tests;
mod types;

use catalog::{
    ProductDefinition, checkout_payload, default_product, product, product_for_amount_minor_units,
    products, released_cards, selected_product,
};
use config::Config;
use error::ApiError;
use process::{DynError, bind_demo_listener};
#[cfg(test)]
use process::{is_cardforge_backend_command, parse_lsof_pids};
use store::CardForgeStore;
use types::{
    CheckoutQuoteRequest, CheckoutQuoteResponse, CheckoutResponse, CreateCheckoutRequest,
    CreateCheckoutSessionRequest, FulfillmentSnapshot, LocalChainInvoiceResponse, PendingOrder,
    ReleasedOrder, StorefrontResponse, WalletActivityResponse, WebhookAck, WebhookLog,
    WebhookReceipt, ZamaPayCheckoutSessionResponse, epoch_millis,
};

#[derive(Clone)]
struct AppState {
    client: Client,
    config: Arc<Config>,
    store: CardForgeStore,
}

#[tokio::main]
async fn main() -> Result<(), DynError> {
    let config = Config::from_env()?;
    let bind_addr = config.bind_addr;
    let state = AppState::new(config).await?;
    let listener = bind_demo_listener(bind_addr).await?;

    println!("CardForge backend listening on http://{bind_addr}");
    axum::serve(listener, app(state)).await?;

    Ok(())
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/storefront", get(storefront))
        .route("/api/fulfillment", get(fulfillment))
        .route("/api/orders/checkout", post(create_checkout))
        .route(
            "/api/wallets/{wallet_address}/activity",
            get(wallet_activity),
        )
        .route("/api/zamapay/webhook", post(receive_webhook))
        .route("/api/zamapay/webhooks", get(webhook_log))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors())
}

impl AppState {
    async fn new(config: Config) -> Result<Self, DbErr> {
        let store = CardForgeStore::connect(&config.database_url, config.store_key.clone()).await?;
        Ok(Self {
            client: Client::new(),
            config: Arc::new(config),
            store,
        })
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn storefront(State(state): State<AppState>) -> Json<StorefrontResponse> {
    Json(StorefrontResponse {
        merchant_label: state.config.merchant_label.clone(),
        zamapay_console_url: state.config.zamapay_console_url.clone(),
        zamapay_login_url: state.config.login_url.clone(),
        product: product(default_product()),
        products: products().collect(),
        project_id: state.config.project_id.clone(),
        webhook_endpoint: state.config.webhook_endpoint.clone(),
    })
}

async fn fulfillment(State(state): State<AppState>) -> Result<Json<FulfillmentSnapshot>, ApiError> {
    Ok(Json(
        state
            .store
            .fulfillment_snapshot()
            .await
            .map_err(ApiError::database_failed)?,
    ))
}

async fn create_checkout(
    State(state): State<AppState>,
    request: Option<Json<CreateCheckoutRequest>>,
) -> Result<Json<CheckoutResponse>, ApiError> {
    let request = request.map(|Json(payload)| payload);
    let product_id = request
        .as_ref()
        .and_then(|payload| payload.product_id.as_deref());
    let buyer_wallet_address = normalize_optional_wallet_address(
        request
            .as_ref()
            .and_then(|payload| payload.buyer_wallet_address.as_deref()),
    )?;
    let selected = selected_product(product_id)?;
    let checkout = create_zamapay_checkout_session(&state, selected).await?;
    record_pending_checkout(&state, selected, &checkout, buyer_wallet_address).await?;

    Ok(Json(CheckoutResponse {
        billing: checkout.billing,
        chain_invoice_id: checkout.chain_invoice_id,
        checkout_session_id: checkout.checkout_session_id,
        checkout_url: checkout.checkout_url,
        invoice_id: checkout.invoice_id,
    }))
}

async fn wallet_activity(
    State(state): State<AppState>,
    Path(wallet_address): Path<String>,
) -> Result<Json<WalletActivityResponse>, ApiError> {
    let wallet_address = normalize_wallet_address(&wallet_address)?;
    Ok(Json(
        state
            .store
            .wallet_activity(&wallet_address)
            .await
            .map_err(ApiError::database_failed)?,
    ))
}

async fn receive_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<WebhookAck>, ApiError> {
    verify_webhook_signature(&state.config, &headers, &payload)?;
    let release_status = release_from_webhook(&state, &payload).await?;
    let receipt = WebhookReceipt {
        id: header_text(&headers, "x-zamapay-webhook-id"),
        signature: header_text(&headers, "x-zamapay-webhook-signature"),
        payload,
    };
    let received_event_count = state
        .store
        .record_webhook(receipt)
        .await
        .map_err(ApiError::database_failed)?;

    Ok(Json(WebhookAck {
        received: true,
        received_event_count,
        release_status,
    }))
}

async fn webhook_log(State(state): State<AppState>) -> Result<Json<WebhookLog>, ApiError> {
    let events = state
        .store
        .webhooks()
        .await
        .map_err(ApiError::database_failed)?;

    Ok(Json(WebhookLog {
        received_event_count: events.len(),
        events,
    }))
}

async fn create_zamapay_checkout_session(
    state: &AppState,
    selected: &ProductDefinition,
) -> Result<ZamaPayCheckoutSessionResponse, ApiError> {
    let mut payload = checkout_payload(selected);
    let quote = create_zamapay_checkout_quote(state, selected.amount_minor_units).await?;
    let chain_invoice = create_local_chain_invoice(state, &payload, &quote).await?;
    payload.chain_invoice_id = Some(chain_invoice.chain_invoice_id);
    payload.chain_tx_hash = Some(chain_invoice.chain_tx_hash);

    let response = state
        .client
        .post(format!(
            "{}/api/projects/{}/checkout-sessions",
            state.config.zamapay_api_url, state.config.project_id
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

    let checkout: ZamaPayCheckoutSessionResponse =
        response.json().await.map_err(ApiError::bad_upstream_json)?;
    if !checkout.billing.is_valid() {
        return Err(ApiError::bad_upstream_shape(
            "ZamaPay returned an invalid billing split.",
        ));
    }

    Ok(checkout)
}

async fn create_zamapay_checkout_quote(
    state: &AppState,
    amount_minor_units: u64,
) -> Result<CheckoutQuoteResponse, ApiError> {
    let response = state
        .client
        .post(format!(
            "{}/api/projects/{}/checkout-quote",
            state.config.zamapay_api_url, state.config.project_id
        ))
        .bearer_auth(&state.config.project_api_key)
        .json(&CheckoutQuoteRequest { amount_minor_units })
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

    let quote: CheckoutQuoteResponse =
        response.json().await.map_err(ApiError::bad_upstream_json)?;
    if !quote.billing.is_valid() {
        return Err(ApiError::bad_upstream_shape(
            "ZamaPay returned an invalid checkout quote.",
        ));
    }

    Ok(quote)
}

async fn create_local_chain_invoice(
    state: &AppState,
    payload: &CreateCheckoutSessionRequest,
    quote: &CheckoutQuoteResponse,
) -> Result<LocalChainInvoiceResponse, ApiError> {
    let response = state
        .client
        .post(format!(
            "{}/api/dev/local-chain-invoice",
            state.config.local_chain_invoice_api_url
        ))
        .json(&serde_json::json!({
            "amountMinorUnits": payload.amount_minor_units,
            "externalRef": payload.merchant_order_id,
            "merchantNetMinorUnits": quote.billing.merchant_net_minor_units,
            "merchantOwnerAddress": quote.merchant_owner_wallet,
            "platformFeeMinorUnits": quote.billing.platform_fee_minor_units,
            "settlementBucketSeed": state.config.project_id,
        }))
        .send()
        .await
        .map_err(ApiError::chain_invoice_unreachable)?;
    let status = response.status();

    if !status.is_success() {
        return Err(ApiError::chain_invoice_rejected(status.as_u16(), response).await);
    }

    response
        .json()
        .await
        .map_err(ApiError::bad_chain_invoice_json)
}

async fn record_pending_checkout(
    state: &AppState,
    selected: &ProductDefinition,
    checkout: &ZamaPayCheckoutSessionResponse,
    buyer_wallet_address: Option<String>,
) -> Result<(), ApiError> {
    let pending = PendingOrder {
        amount_label: selected.amount_label.to_string(),
        amount_minor_units: selected.amount_minor_units,
        buyer_wallet_address,
        chain_invoice_id: checkout.chain_invoice_id,
        checkout_session_id: checkout.checkout_session_id.clone(),
        created_at: epoch_millis(),
        invoice_id: checkout.invoice_id.clone(),
        product_id: selected.id.to_string(),
        product_title: selected.title.to_string(),
    };
    state
        .store
        .record_pending(pending)
        .await
        .map_err(ApiError::database_failed)
}

async fn release_from_webhook(state: &AppState, payload: &Value) -> Result<&'static str, ApiError> {
    let Some(release) = release_from_payload(payload) else {
        return Ok("recorded");
    };

    state
        .store
        .record_release(&release, payload)
        .await
        .map_err(ApiError::database_failed)
}

fn release_from_payload(payload: &Value) -> Option<ReleasedOrder> {
    if payload.get("event")?.as_str()? != "invoice.fulfillment_ready" {
        return None;
    }
    if payload.get("paymentTruth")?.as_str()? != "paid" {
        return None;
    }
    if payload.get("finalityStatus")?.as_str()? != "finality_safe" {
        return None;
    }

    let checkout_session_id = payload.get("checkoutSessionId")?.as_str()?.to_string();
    let invoice_id = payload
        .get("invoiceId")
        .and_then(Value::as_str)
        .unwrap_or(&checkout_session_id)
        .to_string();
    let amount_label = payload
        .get("amountLabel")
        .and_then(Value::as_str)
        .map(str::to_string);
    let selected =
        product_for_amount_minor_units(payload.get("amountMinorUnits").and_then(Value::as_u64));

    Some(ReleasedOrder {
        amount_label,
        cards: released_cards(&checkout_session_id, selected),
        checkout_session_id,
        invoice_id,
    })
}

fn verify_webhook_signature(
    config: &Config,
    headers: &HeaderMap,
    payload: &Value,
) -> Result<(), ApiError> {
    let webhook_id = required_header(headers, "x-zamapay-webhook-id")?;
    let timestamp = required_header(headers, "x-zamapay-webhook-timestamp")?;
    let provided = required_header(headers, "x-zamapay-webhook-signature")?;
    let algorithm = required_header(headers, "x-zamapay-webhook-algorithm")?;

    if algorithm != "keccak256.secret_prefix.v1" {
        return Err(ApiError::invalid_webhook_signature(
            "Unsupported ZamaPay webhook signature algorithm.",
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
            "ZamaPay webhook signature mismatch.",
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
            "ZamaPay webhook signature headers are incomplete.",
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

fn normalize_optional_wallet_address(value: Option<&str>) -> Result<Option<String>, ApiError> {
    value.map(normalize_wallet_address).transpose()
}

fn normalize_wallet_address(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.len() == 42
        && trimmed.starts_with("0x")
        && trimmed.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Ok(trimmed.to_ascii_lowercase());
    }

    Err(ApiError::bad_request(
        "invalid_wallet_address",
        "CardForge buyer wallet address must be a 20-byte hex address.",
    ))
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
