use std::{
    str::FromStr,
    sync::{
        Arc,
        atomic::{AtomicU32, Ordering},
    },
};

use axum::extract::{Path, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::Utc;
use domain::{WebhookDeliveryStatus, ensure_not_expired};
use ethers_core::types::{Address, Signature};
use ethers_core::utils::{hash_message, keccak256};
use fulfillment::{FulfillmentDecision, decide};
use indexer::ProjectionState;
use shared::{
    AddressManifest, CreateInvoiceRequest, DEFAULT_FINALITY_THRESHOLD, DashboardOverview,
    DecryptCallbackRequest, FulfillmentResponse, InvoiceRecord, NonceRequest, NonceResponse,
    OperatorDiagnostics, OperatorSettlementEventRequest, PaymentConfirmationsRequest,
    PaymentProjectionRequest, SessionResponse, VerifyRequest, WebhookDeliveryRequest,
    WebhookDispatchResponse, WebhookEventPayload, WebhookSignatureHeaders, contract_manifest,
    local_dev_contract_manifest,
};
use storage::{DecryptRequestProjection, InMemoryAuthStore, InMemoryPortalStore, StoredSession};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

mod projects;

const SESSION_COOKIE_NAME: &str = "mermer_session";
const OPERATOR_KEY_HEADER: &str = "x-operator-key";
const GATEWAY_KEY_HEADER: &str = "x-zama-gateway-key";
const DEFAULT_OPERATOR_KEY: &str = "local-operator-dev-key";
const DEFAULT_GATEWAY_CALLBACK_KEY: &str = "local-zama-gateway-dev-key";
const DEFAULT_WEBHOOK_SECRET: &str = "local-webhook-dev-secret";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "https://merchant.example/webhooks/mermer-pay";
const DEFAULT_WEBHOOK_MAX_ATTEMPTS: u32 = 3;

#[derive(Clone, Default)]
pub struct AppState {
    store: InMemoryAuthStore,
    portal: InMemoryPortalStore,
    webhook_client: reqwest::Client,
    operator_auth_rejections: Arc<AtomicU32>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            store: InMemoryAuthStore::default(),
            portal: InMemoryPortalStore::from_env(),
            webhook_client: reqwest::Client::new(),
            operator_auth_rejections: Arc::new(AtomicU32::new(0)),
        }
    }

    pub fn issue_dev_session(&self, address: &str) -> shared::SessionUser {
        self.store.create_session(address, Utc::now()).user
    }

    fn operator_auth_rejections(&self) -> u32 {
        self.operator_auth_rejections.load(Ordering::Relaxed)
    }

    fn record_operator_auth_rejection(&self) {
        self.operator_auth_rejections
            .fetch_add(1, Ordering::Relaxed);
    }
}

pub fn app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            origin.as_bytes().starts_with(b"http://127.0.0.1:")
                || origin.as_bytes().starts_with(b"http://localhost:")
        }));

    Router::new()
        .route("/health", get(health))
        .route("/api/auth/nonce", post(issue_nonce))
        .route("/api/auth/verify", post(verify_signature))
        .route("/api/session", get(current_session))
        .merge(projects::routes())
        .route("/api/contracts/local-dev", get(local_dev_contracts))
        .route("/api/contracts/{environment}", get(environment_contracts))
        .route("/api/dashboard/overview", get(dashboard_overview))
        .route("/api/invoices", post(create_invoice))
        .route(
            "/api/invoices/{invoice_id}/fulfillment",
            get(invoice_fulfillment),
        )
        .route(
            "/api/invoices/{invoice_id}/decrypt-request",
            post(request_invoice_decrypt),
        )
        .route("/api/invoices/{invoice_id}", get(invoice_detail))
        .route("/api/operator/diagnostics", get(operator_diagnostics))
        .route(
            "/api/operator/invoices/{invoice_id}/payment-projection",
            post(project_invoice_payment),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/payment-projection",
            post(project_chain_invoice_payment),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/confirmations",
            post(project_chain_invoice_confirmations),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/settlement-event",
            post(project_chain_invoice_settlement_event),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/webhook-delivery",
            post(project_chain_invoice_webhook_delivery),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/webhook-dispatch",
            get(chain_invoice_webhook_dispatch),
        )
        .route(
            "/api/operator/decrypt-requests/{request_id}/callback",
            post(project_decrypt_callback),
        )
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}

async fn health() -> &'static str {
    "ok"
}

async fn issue_nonce(
    State(state): State<AppState>,
    Json(payload): Json<NonceRequest>,
) -> Result<Json<NonceResponse>, ApiError> {
    let now = Utc::now();
    let address = normalize_address(&payload.address)?;
    let challenge = state.store.issue_challenge(&address, now);

    Ok(Json(NonceResponse {
        nonce: challenge.nonce,
        message: challenge.message,
        expires_at: challenge.expires_at,
    }))
}

async fn verify_signature(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<VerifyRequest>,
) -> Result<(CookieJar, Json<SessionResponse>), ApiError> {
    let now = Utc::now();
    let address = normalize_address(&payload.address)?;
    let challenge = state
        .store
        .find_challenge(&address)
        .ok_or(ApiError::unauthorized("unknown auth challenge"))?;

    if challenge.consumed {
        return Err(ApiError::unauthorized("auth challenge already consumed"));
    }

    if challenge.nonce != payload.nonce || challenge.message != payload.message {
        return Err(ApiError::unauthorized("auth challenge mismatch"));
    }

    ensure_not_expired(challenge.issued_at, now)
        .map_err(|_| ApiError::unauthorized("auth challenge expired"))?;
    recover_and_compare_address(&payload.message, &payload.signature, &address)?;

    state.store.consume_challenge(&address);
    let session = state.store.create_session(&address, now);
    let cookie = Cookie::build((SESSION_COOKIE_NAME, session.user.session_id.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .build();

    Ok((
        jar.add(cookie),
        Json(SessionResponse {
            authenticated: true,
            user: Some(session.user),
        }),
    ))
}

async fn current_session(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<SessionResponse>, ApiError> {
    let Some(session) = session_from_cookie(&state, &jar)? else {
        return Ok(Json(SessionResponse {
            authenticated: false,
            user: None,
        }));
    };

    Ok(Json(SessionResponse {
        authenticated: true,
        user: Some(session.user),
    }))
}

async fn dashboard_overview(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<DashboardOverview>, ApiError> {
    let session =
        session_from_cookie(&state, &jar)?.ok_or(ApiError::unauthorized("missing session"))?;
    Ok(Json(state.portal.dashboard_overview(&session.user.address)))
}

async fn local_dev_contracts() -> Result<Json<AddressManifest>, ApiError> {
    let manifest = local_dev_contract_manifest()
        .map_err(|_| ApiError::internal("generated contract manifest is invalid"))?;
    Ok(Json(manifest))
}

async fn environment_contracts(
    Path(environment): Path<String>,
) -> Result<Json<AddressManifest>, ApiError> {
    let manifest = contract_manifest(&environment)
        .map_err(|_| ApiError::internal("generated contract manifest map is invalid"))?
        .ok_or(ApiError::not_found("contract manifest not found"))?;
    Ok(Json(manifest))
}

async fn create_invoice(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<CreateInvoiceRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session =
        session_from_cookie(&state, &jar)?.ok_or(ApiError::unauthorized("missing session"))?;

    let title = payload.title.trim();
    let amount_label = payload.amount_label.trim();
    let note = payload.note.trim();

    if title.is_empty()
        || amount_label.is_empty()
        || note.is_empty()
        || payload.amount_minor_units == 0
    {
        return Err(ApiError::bad_request(
            "title, amountLabel, amountMinorUnits, and note are required",
        ));
    }

    Ok(Json(state.portal.create_invoice(
        title,
        amount_label,
        payload.amount_minor_units,
        note,
        payload.external_ref.as_deref(),
        payload.chain_invoice_id,
        payload.chain_tx_hash.as_deref(),
    )))
}

async fn invoice_detail(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let invoice = state
        .portal
        .invoice_by_id(&invoice_id)
        .ok_or(ApiError::not_found("invoice not found"))?;
    Ok(Json(invoice))
}

async fn invoice_fulfillment(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<FulfillmentResponse>, ApiError> {
    let mut invoice = state
        .portal
        .invoice_by_id(&invoice_id)
        .ok_or(ApiError::not_found("invoice not found"))?;

    if decide(&invoice.snapshot) == FulfillmentDecision::EnqueueRelease
        && invoice.fulfillment_release.is_none()
    {
        invoice = state
            .portal
            .release_fulfillment(&invoice_id, Utc::now(), 0)
            .ok_or(ApiError::not_found("invoice not found"))?;
    }

    Ok(Json(fulfillment_response(&invoice)))
}

async fn request_invoice_decrypt(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session =
        session_from_cookie(&state, &jar)?.ok_or(ApiError::unauthorized("missing session"))?;

    match state
        .portal
        .request_invoice_decrypt(&invoice_id, Utc::now())
    {
        Some(DecryptRequestProjection::Created(invoice)) => Ok(Json(invoice)),
        Some(DecryptRequestProjection::AlreadyPending(_)) => {
            Err(ApiError::conflict("decrypt request already pending"))
        }
        Some(DecryptRequestProjection::NotPaid(_)) => {
            Err(ApiError::conflict("decrypt request requires paid invoice"))
        }
        None => Err(ApiError::not_found("invoice not found")),
    }
}

async fn operator_diagnostics(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<OperatorDiagnostics>, ApiError> {
    require_operator_key(&state, &headers)?;

    Ok(Json(
        state
            .portal
            .operator_diagnostics(state.operator_auth_rejections()),
    ))
}

async fn project_invoice_payment(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers)?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;

    let invoice = state
        .portal
        .project_invoice_paid(
            &invoice_id,
            payload.chain_invoice_id,
            payment_tx_hash,
            payer_address,
        )
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_payment(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers)?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;
    let invoice = state
        .portal
        .project_chain_invoice_paid(chain_invoice_id, payment_tx_hash, payer_address)
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_confirmations(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentConfirmationsRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers)?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .ok_or(ApiError::not_found("invoice not found"))?;
    let finality_threshold = payload
        .finality_threshold
        .unwrap_or(DEFAULT_FINALITY_THRESHOLD);
    let mut projection = ProjectionState::from_snapshot(invoice.snapshot, finality_threshold);
    projection.apply_confirmations(payload.confirmations);

    let invoice = state
        .portal
        .project_chain_invoice_finality_snapshot(
            chain_invoice_id,
            projection.snapshot().clone(),
            payload.confirmations,
            finality_threshold,
        )
        .ok_or(ApiError::not_found("invoice not found"))?;

    if let Some(project_id) = invoice.project_id.as_deref() {
        projects::dispatch_project_deliveries(&state, project_id).await?;
    }

    Ok(Json(invoice))
}

async fn project_chain_invoice_settlement_event(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<OperatorSettlementEventRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers)?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .ok_or(ApiError::not_found("invoice not found"))?;
    let finality_threshold = payload
        .finality_threshold
        .unwrap_or(DEFAULT_FINALITY_THRESHOLD);
    let mut projection = ProjectionState::from_snapshot(invoice.snapshot, finality_threshold);
    projection.apply_operator_event(payload.event);

    let invoice = state
        .portal
        .project_chain_invoice_snapshot(chain_invoice_id, projection.snapshot().clone())
        .ok_or(ApiError::not_found("invoice not found"))?;

    if let Some(project_id) = invoice.project_id.as_deref() {
        projects::dispatch_project_deliveries(&state, project_id).await?;
    }

    Ok(Json(invoice))
}

async fn project_chain_invoice_webhook_delivery(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<WebhookDeliveryRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers)?;

    let max_attempts = validated_webhook_max_attempts(payload.max_attempts)?;
    let invoice = state
        .portal
        .project_chain_invoice_webhook_delivery(chain_invoice_id, payload.outcome, max_attempts)
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn chain_invoice_webhook_dispatch(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
) -> Result<Json<WebhookDispatchResponse>, ApiError> {
    require_operator_key(&state, &headers)?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .ok_or(ApiError::not_found("invoice not found"))?;

    let secret = webhook_secret()?;
    Ok(Json(signed_webhook_dispatch(
        &invoice,
        chain_invoice_id,
        &webhook_endpoint(),
        &secret,
        Utc::now(),
    )?))
}

async fn project_decrypt_callback(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<DecryptCallbackRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_gateway_key(&headers)?;

    let callback_sender = payload.callback_sender.trim();
    if callback_sender.is_empty() {
        return Err(ApiError::bad_request("callbackSender is required"));
    }

    let invoice = state
        .portal
        .project_decrypt_callback(&request_id, payload.outcome, callback_sender, Utc::now())
        .ok_or(ApiError::not_found("decrypt request not found"))?;

    Ok(Json(invoice))
}

fn validated_payment_projection(
    payload: &PaymentProjectionRequest,
) -> Result<(&str, &str), ApiError> {
    let payment_tx_hash = payload.payment_tx_hash.trim();
    let payer_address = payload.payer_address.trim();

    if payment_tx_hash.is_empty() || payer_address.is_empty() {
        return Err(ApiError::bad_request(
            "paymentTxHash and payerAddress are required",
        ));
    }

    Ok((payment_tx_hash, payer_address))
}

fn validated_webhook_max_attempts(max_attempts: Option<u32>) -> Result<u32, ApiError> {
    let max_attempts = max_attempts.unwrap_or(DEFAULT_WEBHOOK_MAX_ATTEMPTS);

    if max_attempts == 0 {
        return Err(ApiError::bad_request(
            "maxAttempts must be greater than zero",
        ));
    }

    Ok(max_attempts)
}

fn signed_webhook_dispatch(
    invoice: &InvoiceRecord,
    chain_invoice_id: u64,
    endpoint: &str,
    secret: &str,
    now: chrono::DateTime<Utc>,
) -> Result<WebhookDispatchResponse, ApiError> {
    if !invoice.snapshot.is_fulfillment_ready() {
        return Err(ApiError::conflict(
            "webhook dispatch requires finality-safe paid invoice",
        ));
    }

    if invoice.webhook.status == WebhookDeliveryStatus::Delivered {
        return Err(ApiError::conflict("webhook already delivered"));
    }

    let payload = WebhookEventPayload {
        event: "invoice.fulfillment_ready".to_string(),
        invoice_id: invoice.invoice_id.clone(),
        chain_invoice_id,
        payment_tx_hash: invoice.payment_tx_hash.clone(),
        payer_address: invoice.payer_address.clone(),
        amount_minor_units: invoice.amount_minor_units,
        amount_label: invoice.amount_label.clone(),
        payment_truth: invoice.snapshot.payment_truth,
        finality_status: invoice.snapshot.finality_status,
        fulfillment_status: invoice.snapshot.fulfillment_status,
        webhook_attempt_count: invoice.webhook.attempt_count,
    };
    let canonical_body = serde_json::to_string(&payload)
        .map_err(|_| ApiError::internal("failed to serialize webhook payload"))?;
    let webhook_id = format!("wh_{}", Uuid::new_v4().simple());
    let timestamp = now.to_rfc3339();
    let signature_base = format!("{webhook_id}.{timestamp}.{canonical_body}");
    let signature = format!("v1={}", keyed_digest(secret, &signature_base));

    Ok(WebhookDispatchResponse {
        endpoint: endpoint.to_string(),
        headers: WebhookSignatureHeaders {
            x_mermer_webhook_id: webhook_id,
            x_mermer_webhook_timestamp: timestamp,
            x_mermer_webhook_signature: signature,
            x_mermer_webhook_algorithm: "keccak256.secret_prefix.v1".to_string(),
        },
        payload,
        canonical_body,
        signature_base,
    })
}

fn webhook_endpoint() -> String {
    std::env::var("MERMER_WEBHOOK_ENDPOINT")
        .ok()
        .filter(|endpoint| !endpoint.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WEBHOOK_ENDPOINT.to_string())
}

fn webhook_secret() -> Result<String, ApiError> {
    let secret = std::env::var("MERMER_WEBHOOK_SECRET")
        .ok()
        .filter(|secret| !secret.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WEBHOOK_SECRET.to_string());

    if contract_environment() == "sepolia" && secret == DEFAULT_WEBHOOK_SECRET {
        return Err(ApiError::locked(
            "Sepolia webhook dispatch requires a non-default MERMER_WEBHOOK_SECRET",
        ));
    }

    Ok(secret)
}

fn contract_environment() -> String {
    std::env::var("MERMER_CONTRACT_ENV")
        .or_else(|_| std::env::var("NEXT_PUBLIC_CONTRACT_ENV"))
        .unwrap_or_else(|_| "local-dev".to_string())
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

fn fulfillment_response(invoice: &InvoiceRecord) -> FulfillmentResponse {
    let decision = decide(&invoice.snapshot);
    let release = invoice.fulfillment_release.clone();
    let decision =
        if release.is_some() && decision != FulfillmentDecision::FreezeForManualIntervention {
            "released"
        } else {
            decision_label(decision)
        };

    FulfillmentResponse {
        invoice_id: invoice.invoice_id.clone(),
        decision: decision.to_string(),
        artifacts: Vec::new(),
        release,
    }
}

fn decision_label(decision: FulfillmentDecision) -> &'static str {
    match decision {
        FulfillmentDecision::Hold => "hold",
        FulfillmentDecision::EnqueueRelease => "enqueue_release",
        FulfillmentDecision::FreezeForManualIntervention => "freeze_for_manual_intervention",
    }
}

fn require_operator_key(state: &AppState, headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    match validate_operator_key(headers) {
        Ok(()) => Ok(()),
        Err(error) => {
            state.record_operator_auth_rejection();
            Err(error)
        }
    }
}

fn validate_operator_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(OPERATOR_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing operator key"));
    };

    let expected =
        std::env::var("MERMER_OPERATOR_KEY").unwrap_or_else(|_| DEFAULT_OPERATOR_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid operator key"));
    }

    Ok(())
}

fn require_gateway_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(GATEWAY_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing gateway callback key"));
    };

    let expected = std::env::var("MERMER_GATEWAY_CALLBACK_KEY")
        .unwrap_or_else(|_| DEFAULT_GATEWAY_CALLBACK_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid gateway callback key"));
    }

    Ok(())
}

fn session_from_cookie(
    state: &AppState,
    jar: &CookieJar,
) -> Result<Option<StoredSession>, ApiError> {
    let Some(raw_session_cookie) = jar.get(SESSION_COOKIE_NAME) else {
        return Ok(None);
    };

    let session_id = Uuid::parse_str(raw_session_cookie.value())
        .map_err(|_| ApiError::unauthorized("invalid session"))?;
    let Some(session) = state.store.find_session(&session_id) else {
        return Ok(None);
    };

    Ok(Some(session))
}

fn recover_and_compare_address(
    message: &str,
    signature: &str,
    expected_address: &str,
) -> Result<(), ApiError> {
    let signature = Signature::from_str(signature)
        .map_err(|_| ApiError::unauthorized("invalid signature encoding"))?;
    let digest = hash_message(message);
    let recovered = signature
        .recover(digest)
        .map_err(|_| ApiError::unauthorized("signature recovery failed"))?;

    let expected = Address::from_str(expected_address)
        .map_err(|_| ApiError::bad_request("invalid address"))?;
    if recovered != expected {
        return Err(ApiError::unauthorized("signature address mismatch"));
    }

    Ok(())
}

fn normalize_address(raw: &str) -> Result<String, ApiError> {
    let parsed = Address::from_str(raw).map_err(|_| ApiError::bad_request("invalid address"))?;
    Ok(format!("{parsed:?}"))
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn locked(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::LOCKED,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.status, self.message).into_response()
    }
}
