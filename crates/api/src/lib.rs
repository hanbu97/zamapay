use std::{str::FromStr, sync::Arc};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use domain::ensure_not_expired;
use ethers_core::types::{Address, Signature};
use ethers_core::utils::hash_message;
use fulfillment::{FulfillmentDecision, decide};
use indexer::ProjectionState;
use shared::{
    AddressManifest, CreateInvoiceRequest, DEFAULT_FINALITY_THRESHOLD, DashboardOverview,
    DecryptCallbackRequest, EvmIndexerCursor, EvmIndexerCursorProjectionRequest,
    EvmIndexerWatchlist, EvmSettlementEventProjectionRequest, EvmSettlementEventProjectionResponse,
    FulfillmentResponse, InvoiceRecord, NonceRequest, NonceResponse, OperatorDiagnostics,
    OperatorSettlementEventRequest, PaymentConfirmationsRequest, PaymentProjectionRequest,
    PublicCheckoutResponse, SessionResponse, SupportedEvmAsset, VerifyRequest,
    WebhookDeliveryRequest, contract_manifest,
};
use storage::{AuthStore, DecryptRequestProjection, PortalStore, StoredSession};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

mod billing;
mod http_policy;
mod projects;
mod runtime_profile;

const SESSION_COOKIE_NAME: &str = "zamapay_session";
const OPERATOR_KEY_HEADER: &str = "x-operator-key";
const GATEWAY_KEY_HEADER: &str = "x-zama-gateway-key";
const DEFAULT_OPERATOR_KEY: &str = "local-operator-dev-key";
const DEFAULT_GATEWAY_CALLBACK_KEY: &str = "local-zama-gateway-dev-key";
const DEFAULT_WEBHOOK_MAX_ATTEMPTS: u32 = 3;

#[derive(Clone)]
pub struct AppState {
    store: AuthStore,
    portal: PortalStore,
    webhook_client: reqwest::Client,
    operator_auth_rejections: Arc<RwLock<u32>>,
}

impl AppState {
    pub async fn new() -> Self {
        Self::with_portal(PortalStore::from_env().await)
    }

    pub fn with_portal(portal: PortalStore) -> Self {
        Self {
            store: AuthStore::default(),
            portal,
            webhook_client: reqwest::Client::new(),
            operator_auth_rejections: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn issue_dev_session(&self, address: &str) -> shared::SessionUser {
        self.store.create_session(address, Utc::now()).await.user
    }

    async fn operator_auth_rejections(&self) -> u32 {
        *self.operator_auth_rejections.read().await
    }

    async fn record_operator_auth_rejection(&self) {
        *self.operator_auth_rejections.write().await += 1;
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/auth/nonce", post(issue_nonce))
        .route("/api/auth/verify", post(verify_signature))
        .route("/api/session", get(current_session).delete(delete_session))
        .merge(billing::routes())
        .merge(projects::routes())
        .route(
            "/api/contracts/{environment}",
            get(contract_environment_manifest),
        )
        .route("/api/supported-assets", get(supported_assets))
        .route("/api/checkout/{checkout_id}", get(public_checkout))
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
        .route("/api/operator/evm/watchlist", get(evm_indexer_watchlist))
        .route(
            "/api/operator/evm/settlement-events",
            post(project_evm_settlement_event),
        )
        .route(
            "/api/operator/evm/cursors",
            post(project_evm_indexer_cursor),
        )
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
        .layer(http_policy::cors_layer())
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
    let challenge = state.store.issue_challenge(&address, now).await;

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
        .await
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

    state.store.consume_challenge(&address).await;
    let session = state.store.create_session(&address, now).await;
    let cookie =
        http_policy::session_cookie(SESSION_COOKIE_NAME, session.user.session_id.to_string());

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
    let Some(session) = session_from_cookie(&state, &jar).await? else {
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

async fn delete_session(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), ApiError> {
    if let Some(session_id) = session_id_from_cookie_lossy(&jar) {
        state.store.delete_session(&session_id).await;
    }

    let cookie = http_policy::expired_session_cookie(SESSION_COOKIE_NAME);
    Ok((jar.remove(cookie), StatusCode::NO_CONTENT))
}

async fn dashboard_overview(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<DashboardOverview>, ApiError> {
    let session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;
    Ok(Json(
        state.portal.dashboard_overview(&session.user.address).await,
    ))
}

async fn contract_environment_manifest(
    Path(environment): Path<String>,
) -> Result<Json<AddressManifest>, ApiError> {
    let manifest = contract_manifest(&environment)
        .map_err(|_| ApiError::internal("generated contract manifest is invalid"))?
        .ok_or_else(|| {
            ApiError::not_found("contract manifest is not available for this environment")
        })?;
    Ok(Json(manifest))
}

async fn supported_assets(
    State(state): State<AppState>,
) -> Result<Json<Vec<SupportedEvmAsset>>, ApiError> {
    Ok(Json(state.portal.supported_evm_assets().await))
}

async fn public_checkout(
    State(state): State<AppState>,
    Path(checkout_id): Path<String>,
) -> Result<Json<PublicCheckoutResponse>, ApiError> {
    state
        .portal
        .public_checkout_by_id(&checkout_id)
        .await
        .map(Json)
        .ok_or(ApiError::not_found("checkout not found"))
}

async fn create_invoice(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<CreateInvoiceRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;

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

    Ok(Json(
        state
            .portal
            .create_invoice(
                title,
                amount_label,
                payload.amount_minor_units,
                note,
                payload.external_ref.as_deref(),
                payload.chain_invoice_id,
                payload.chain_tx_hash.as_deref(),
            )
            .await,
    ))
}

async fn invoice_detail(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let invoice = state
        .portal
        .invoice_by_id(&invoice_id)
        .await
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
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    if decide(&invoice.snapshot) == FulfillmentDecision::EnqueueRelease
        && invoice.fulfillment_release.is_none()
    {
        invoice = state
            .portal
            .release_fulfillment(&invoice_id, Utc::now(), 0)
            .await
            .ok_or(ApiError::not_found("invoice not found"))?;
    }

    Ok(Json(fulfillment_response(&invoice)))
}

async fn request_invoice_decrypt(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;

    match state
        .portal
        .request_invoice_decrypt(&invoice_id, Utc::now())
        .await
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
    require_operator_key(&state, &headers).await?;

    Ok(Json(
        state
            .portal
            .operator_diagnostics(state.operator_auth_rejections().await)
            .await,
    ))
}

async fn evm_indexer_watchlist(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<EvmIndexerWatchlist>, ApiError> {
    require_operator_key(&state, &headers).await?;
    Ok(Json(state.portal.evm_indexer_watchlist(Utc::now()).await))
}

async fn project_evm_settlement_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<EvmSettlementEventProjectionRequest>,
) -> Result<Json<EvmSettlementEventProjectionResponse>, ApiError> {
    require_operator_key(&state, &headers).await?;
    validate_evm_settlement_event_projection(&payload)?;
    let projected = state
        .portal
        .project_evm_settlement_event(payload, Utc::now())
        .await;
    if let Some(invoice) = projected.invoice.as_ref() {
        if invoice.snapshot.is_fulfillment_ready() {
            if let Some(project_id) = invoice.project_id.as_deref() {
                projects::dispatch_project_deliveries(&state, project_id).await?;
            }
        }
    }
    Ok(Json(projected))
}

async fn project_evm_indexer_cursor(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<EvmIndexerCursorProjectionRequest>,
) -> Result<Json<EvmIndexerCursor>, ApiError> {
    require_operator_key(&state, &headers).await?;
    validate_evm_cursor_projection(&payload)?;
    Ok(Json(
        state
            .portal
            .project_evm_indexer_cursor(payload, Utc::now())
            .await,
    ))
}

async fn project_invoice_payment(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;

    let invoice = state
        .portal
        .project_invoice_paid(
            &invoice_id,
            payload.chain_invoice_id,
            payment_tx_hash,
            payer_address,
        )
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_payment(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;
    let invoice = state
        .portal
        .project_chain_invoice_paid(chain_invoice_id, payment_tx_hash, payer_address)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_confirmations(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentConfirmationsRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
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
        .await
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
    require_operator_key(&state, &headers).await?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;
    let finality_threshold = payload
        .finality_threshold
        .unwrap_or(DEFAULT_FINALITY_THRESHOLD);
    let mut projection = ProjectionState::from_snapshot(invoice.snapshot, finality_threshold);
    projection.apply_operator_event(payload.event);

    let invoice = state
        .portal
        .project_chain_invoice_snapshot(chain_invoice_id, projection.snapshot().clone())
        .await
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
    require_operator_key(&state, &headers).await?;

    let max_attempts = validated_webhook_max_attempts(payload.max_attempts)?;
    let invoice = state
        .portal
        .project_chain_invoice_webhook_delivery(chain_invoice_id, payload.outcome, max_attempts)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn chain_invoice_webhook_dispatch(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
) -> Result<(StatusCode, &'static str), ApiError> {
    require_operator_key(&state, &headers).await?;

    let _ = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok((
        StatusCode::GONE,
        "operator webhook dispatch was retired; use project webhook delivery outbox",
    ))
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
        .await
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

fn validate_evm_settlement_event_projection(
    payload: &EvmSettlementEventProjectionRequest,
) -> Result<(), ApiError> {
    if payload.chain_id == 0 {
        return Err(ApiError::bad_request("chainId must be greater than zero"));
    }
    if payload.amount_minor_units == 0 {
        return Err(ApiError::bad_request(
            "amountMinorUnits must be greater than zero",
        ));
    }
    if payload
        .merchant_net_minor_units
        .checked_add(payload.platform_fee_minor_units)
        != Some(payload.amount_minor_units)
    {
        return Err(ApiError::bad_request(
            "merchantNetMinorUnits plus platformFeeMinorUnits must equal amountMinorUnits",
        ));
    }
    for (label, value) in [
        ("settlementIntentId", payload.settlement_intent_id.as_str()),
        (
            "settlementProjectId",
            payload.settlement_project_id.as_str(),
        ),
        ("settlementContract", payload.settlement_contract.as_str()),
        ("tokenContract", payload.token_contract.as_str()),
        ("txHash", payload.tx_hash.as_str()),
        ("fromAddress", payload.from_address.as_str()),
        ("toAddress", payload.to_address.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(ApiError::bad_request(format!("{label} is required")));
        }
    }
    validate_evm_hash("txHash", &payload.tx_hash)?;
    validate_evm_hash("settlementIntentId", &payload.settlement_intent_id)?;
    validate_evm_hash("settlementProjectId", &payload.settlement_project_id)?;
    if let Some(block_hash) = payload.block_hash.as_deref() {
        validate_evm_hash("blockHash", block_hash)?;
    }
    validate_evm_address("settlementContract", &payload.settlement_contract)?;
    validate_evm_address("tokenContract", &payload.token_contract)?;
    validate_evm_address("fromAddress", &payload.from_address)?;
    validate_evm_address("toAddress", &payload.to_address)?;
    if !payload
        .to_address
        .eq_ignore_ascii_case(&payload.settlement_contract)
    {
        return Err(ApiError::bad_request(
            "toAddress must equal settlementContract",
        ));
    }
    Ok(())
}

fn validate_evm_cursor_projection(
    payload: &EvmIndexerCursorProjectionRequest,
) -> Result<(), ApiError> {
    if payload.chain_id == 0 {
        return Err(ApiError::bad_request("chainId must be greater than zero"));
    }
    if payload.last_finalized_block > payload.last_scanned_block {
        return Err(ApiError::bad_request(
            "lastFinalizedBlock cannot exceed lastScannedBlock",
        ));
    }
    validate_evm_address("settlementContract", &payload.settlement_contract)?;
    Ok(())
}

fn validate_evm_address(label: &str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() != 42
        || !value.starts_with("0x")
        || !value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err(ApiError::bad_request(format!(
            "{label} must be a 20-byte hex address"
        )));
    }
    Ok(())
}

fn validate_evm_hash(label: &str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() != 66
        || !value.starts_with("0x")
        || !value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err(ApiError::bad_request(format!(
            "{label} must be a 32-byte hex hash"
        )));
    }
    Ok(())
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

async fn require_operator_key(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ApiError> {
    match validate_operator_key(headers) {
        Ok(()) => Ok(()),
        Err(error) => {
            state.record_operator_auth_rejection().await;
            Err(error)
        }
    }
}

fn validate_operator_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(OPERATOR_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing operator key"));
    };

    let expected =
        std::env::var("ZAMAPAY_OPERATOR_KEY").unwrap_or_else(|_| DEFAULT_OPERATOR_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid operator key"));
    }

    Ok(())
}

fn require_gateway_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(GATEWAY_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing gateway callback key"));
    };

    let expected = std::env::var("ZAMAPAY_GATEWAY_CALLBACK_KEY")
        .unwrap_or_else(|_| DEFAULT_GATEWAY_CALLBACK_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid gateway callback key"));
    }

    Ok(())
}

async fn session_from_cookie(
    state: &AppState,
    jar: &CookieJar,
) -> Result<Option<StoredSession>, ApiError> {
    let Some(raw_session_cookie) = jar.get(SESSION_COOKIE_NAME) else {
        return Ok(None);
    };

    let session_id = Uuid::parse_str(raw_session_cookie.value())
        .map_err(|_| ApiError::unauthorized("invalid session"))?;
    let Some(session) = state.store.find_session(&session_id).await else {
        return Ok(None);
    };

    Ok(Some(session))
}

fn session_id_from_cookie_lossy(jar: &CookieJar) -> Option<Uuid> {
    jar.get(SESSION_COOKIE_NAME)
        .and_then(|cookie| Uuid::parse_str(cookie.value()).ok())
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

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
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
