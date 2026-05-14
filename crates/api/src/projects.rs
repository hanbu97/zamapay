use std::sync::OnceLock;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use shared::{
    CheckoutQuoteRequest, CheckoutQuoteResponse, CheckoutSession, CheckoutSessionResponse,
    ConfigureWebhookEndpointRequest, CreateCheckoutSessionRequest, CreatePaymentProjectRequest,
    CreateProjectApiKeyRequest, CreateProjectWithdrawalRequest, PaymentProject, PaymentRail,
    ProjectDashboardOverview, ProjectEnvironmentKind, RotateWebhookEndpointSecretResponse,
    SVIX_ID_HEADER, SVIX_SIGNATURE_HEADER, SVIX_TIMESTAMP_HEADER, UpdateProjectPaymentRailRequest,
    WebhookDeliveryAttemptRecord, WebhookDeliveryRecord, WebhookEventRecord,
    try_sign_webhook_payload_with_secrets,
};
use storage::{CheckoutSessionError, ProjectWithdrawalScope};

use super::{ApiError, AppState, session_from_cookie};
use crate::runtime_profile;

const DEFAULT_PUBLIC_DEMO_PROJECT_ID: &str = "proj_62dc3460ccb749a388c40356c101a01f";
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";
static PUBLIC_DEMO_PROJECT_ID: OnceLock<String> = OnceLock::new();

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/projects", get(list_projects).post(create_project))
        .route(
            "/api/project-secret/bootstrap",
            get(project_secret_bootstrap),
        )
        .route("/api/projects/{project_id}", get(project_overview))
        .route(
            "/api/projects/{project_id}/payment-rails/{payment_rail}",
            patch(update_project_payment_rail),
        )
        .route(
            "/api/projects/{project_id}/project-secrets",
            post(create_project_secret),
        )
        .route(
            "/api/projects/{project_id}/project-secrets/{key_id}/revoke",
            post(revoke_project_secret),
        )
        .route(
            "/api/projects/{project_id}/webhook-endpoints",
            post(configure_webhook_endpoint),
        )
        .route(
            "/api/projects/{project_id}/webhook-endpoints/{endpoint_id}",
            patch(configure_webhook_endpoint_patch),
        )
        .route(
            "/api/projects/{project_id}/webhook-endpoints/{endpoint_id}/rotate-secret",
            post(rotate_webhook_endpoint_secret),
        )
        .route(
            "/api/projects/{project_id}/webhook-endpoints/{endpoint_id}/test",
            post(test_webhook_endpoint),
        )
        .route(
            "/api/projects/{project_id}/checkout-sessions",
            get(list_checkout_sessions).post(create_checkout_session),
        )
        .route(
            "/api/projects/{project_id}/checkout-quote",
            post(create_checkout_quote),
        )
        .route(
            "/api/projects/{project_id}/checkout-sessions/{checkout_session_id}",
            get(checkout_session_detail),
        )
        .route("/api/projects/{project_id}/events", get(list_events))
        .route(
            "/api/projects/{project_id}/deliveries",
            get(list_deliveries),
        )
        .route(
            "/api/projects/{project_id}/deliveries/{delivery_id}/resend",
            post(resend_delivery),
        )
        .route(
            "/api/projects/{project_id}/withdrawals",
            post(create_withdrawal),
        )
}

async fn project_secret_bootstrap(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<shared::ProjectSecretBootstrapResponse>, ApiError> {
    let secret_key = bearer_token(&headers)?;
    state
        .portal
        .project_secret_bootstrap(secret_key, Utc::now())
        .await
        .map(Json)
        .ok_or(ApiError::unauthorized("invalid project secret key"))
}

async fn list_projects(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<Vec<PaymentProject>>, ApiError> {
    let session = require_session(&state, &jar).await?;
    Ok(Json(
        state.portal.list_projects(&session.user.address).await,
    ))
}

async fn create_project(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<CreatePaymentProjectRequest>,
) -> Result<Json<shared::CreatePaymentProjectResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("project name is required"));
    }

    let now = Utc::now();
    if let Some(requested_plan) = payload.billing_plan {
        let subscription = state
            .portal
            .billing_subscription(&session.user.address, now)
            .await;
        if requested_plan != subscription.subscription.effective_plan() {
            return Err(ApiError::forbidden(
                "project billing plan comes from the active subscription; upgrade before using a paid rate",
            ));
        }
    }

    let created = state
        .portal
        .create_project(
            &session.user.address,
            name,
            payload
                .environment
                .unwrap_or(ProjectEnvironmentKind::LocalDev),
            payload.webhook_url.as_deref(),
            now,
        )
        .await;

    Ok(Json(created))
}

async fn project_overview(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectDashboardOverview>, ApiError> {
    let overview = state
        .portal
        .project_overview(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;

    if is_public_demo_project(&project_id) {
        return Ok(Json(overview));
    }

    let session = require_session(&state, &jar).await?;
    require_project_owner(&overview.project, &session.user.address)?;
    Ok(Json(overview))
}

async fn update_project_payment_rail(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, payment_rail)): Path<(String, String)>,
    Json(payload): Json<UpdateProjectPaymentRailRequest>,
) -> Result<Json<ProjectDashboardOverview>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let payment_rail = parse_payment_rail(&payment_rail)?;
    state
        .portal
        .update_project_payment_rail(&project_id, payment_rail, payload.enabled, Utc::now())
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    state
        .portal
        .project_overview(&project_id)
        .await
        .map(Json)
        .ok_or(ApiError::not_found("project not found"))
}

async fn create_project_secret(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
    Json(payload): Json<CreateProjectApiKeyRequest>,
) -> Result<Json<shared::CreateProjectApiKeyResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let label = payload
        .label
        .as_deref()
        .unwrap_or("Default project secret")
        .trim();
    let response = state
        .portal
        .create_project_api_key(
            &project_id,
            payload.environment.unwrap_or(project.default_environment),
            label,
            Utc::now(),
        )
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    Ok(Json(response))
}

async fn revoke_project_secret(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, key_id)): Path<(String, String)>,
) -> Result<Json<shared::ProjectApiKey>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let key = state
        .portal
        .revoke_project_api_key(&project_id, &key_id, Utc::now())
        .await
        .ok_or(ApiError::not_found("project secret not found"))?;
    Ok(Json(key))
}

async fn configure_webhook_endpoint(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
    Json(payload): Json<ConfigureWebhookEndpointRequest>,
) -> Result<Json<shared::ConfigureWebhookEndpointResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let url = validated_webhook_url(&payload.url)?;
    let configured = state
        .portal
        .configure_webhook_endpoint(
            &project_id,
            payload.environment.unwrap_or(project.default_environment),
            url,
            Utc::now(),
        )
        .await;
    Ok(Json(configured))
}

async fn configure_webhook_endpoint_patch(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, endpoint_id)): Path<(String, String)>,
    Json(payload): Json<ConfigureWebhookEndpointRequest>,
) -> Result<Json<shared::ProjectWebhookEndpoint>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let url = validated_webhook_url(&payload.url)?;
    let endpoint = state
        .portal
        .update_webhook_endpoint(
            &project_id,
            &endpoint_id,
            payload.environment.unwrap_or(project.default_environment),
            url,
            payload.enabled.unwrap_or(true),
            Utc::now(),
        )
        .await
        .ok_or(ApiError::not_found("webhook endpoint not found"))?;
    Ok(Json(endpoint))
}

async fn rotate_webhook_endpoint_secret(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, endpoint_id)): Path<(String, String)>,
) -> Result<Json<RotateWebhookEndpointSecretResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let response = state
        .portal
        .rotate_webhook_endpoint_secret(&project_id, &endpoint_id, Utc::now())
        .await
        .ok_or(ApiError::not_found("webhook endpoint not found"))?;
    Ok(Json(response))
}

async fn test_webhook_endpoint(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, endpoint_id)): Path<(String, String)>,
) -> Result<Json<Vec<WebhookDeliveryRecord>>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&project, &session.user.address)?;
    let delivery = state
        .portal
        .create_test_webhook_delivery(
            &project_id,
            &endpoint_id,
            project.default_environment,
            Utc::now(),
        )
        .await
        .ok_or(ApiError::not_found("webhook endpoint not found"))?;
    Ok(Json(dispatch_delivery(&state, delivery).await?))
}

async fn list_checkout_sessions(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<CheckoutSession>>, ApiError> {
    let overview = owned_overview(&state, &jar, &project_id).await?;
    Ok(Json(overview.checkout_sessions))
}

async fn create_checkout_session(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<CreateCheckoutSessionRequest>,
) -> Result<Json<CheckoutSessionResponse>, ApiError> {
    let api_key = bearer_token(&headers)?;
    let idempotency_key = required_header(&headers, IDEMPOTENCY_KEY_HEADER)?;
    let checkout = state
        .portal
        .create_checkout_session(
            &project_id,
            api_key,
            idempotency_key,
            payload,
            &checkout_base_url(),
            Utc::now(),
        )
        .await
        .map_err(checkout_error)?;
    let project = state
        .portal
        .project_by_id(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    let evm_payment_intent = match checkout.payment_intent_id.as_deref() {
        Some(intent_id) => state.portal.evm_payment_intent_by_id(intent_id).await,
        None => None,
    };

    Ok(Json(CheckoutSessionResponse {
        session: checkout,
        merchant_owner_wallet: project.owner_wallet,
        evm_payment_intent,
    }))
}

async fn create_checkout_quote(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<CheckoutQuoteRequest>,
) -> Result<Json<CheckoutQuoteResponse>, ApiError> {
    let api_key = bearer_token(&headers)?;
    let quote = state
        .portal
        .checkout_quote(&project_id, api_key, payload.amount_minor_units, Utc::now())
        .await
        .map_err(checkout_error)?;
    Ok(Json(quote))
}

async fn checkout_session_detail(
    State(state): State<AppState>,
    Path((project_id, checkout_session_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<CheckoutSession>, ApiError> {
    let api_key = bearer_token(&headers)?;
    let checkout = state
        .portal
        .verify_checkout_session_access(&project_id, &checkout_session_id, api_key, Utc::now())
        .await
        .map_err(checkout_error)?;
    Ok(Json(checkout))
}

async fn list_events(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<WebhookEventRecord>>, ApiError> {
    let overview = owned_overview(&state, &jar, &project_id).await?;
    Ok(Json(overview.webhook_events))
}

async fn list_deliveries(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<WebhookDeliveryRecord>>, ApiError> {
    let overview = owned_overview(&state, &jar, &project_id).await?;
    Ok(Json(overview.webhook_deliveries))
}

async fn resend_delivery(
    State(state): State<AppState>,
    jar: CookieJar,
    Path((project_id, delivery_id)): Path<(String, String)>,
) -> Result<Json<Vec<WebhookDeliveryRecord>>, ApiError> {
    let _overview = owned_overview(&state, &jar, &project_id).await?;
    let delivery = state
        .portal
        .reschedule_webhook_delivery(&project_id, &delivery_id, Utc::now())
        .await
        .ok_or(ApiError::not_found("webhook delivery not found"))?;
    Ok(Json(dispatch_delivery(&state, delivery).await?))
}

async fn create_withdrawal(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(project_id): Path<String>,
    Json(payload): Json<CreateProjectWithdrawalRequest>,
) -> Result<Json<ProjectDashboardOverview>, ApiError> {
    let overview = owned_overview(&state, &jar, &project_id).await?;
    if payload.amount_minor_units == 0 {
        return Err(ApiError::bad_request(
            "withdraw amount must be greater than zero",
        ));
    }
    if payload.amount_minor_units > overview.summary.withdrawable_minor_units {
        return Err(ApiError::conflict(
            "withdraw amount exceeds available project balance",
        ));
    }
    if !is_transaction_hash(&payload.chain_tx_hash) {
        return Err(ApiError::bad_request(
            "chainTxHash must be a transaction hash",
        ));
    }
    let has_asset_scope = payload.chain_id.is_some()
        || payload.token_contract.is_some()
        || payload.settlement_contract.is_some();
    if has_asset_scope && (payload.chain_id.is_none() || payload.token_contract.is_none()) {
        return Err(ApiError::bad_request(
            "chainId and tokenContract are required for token-scoped withdrawals",
        ));
    }
    if payload
        .token_contract
        .as_deref()
        .is_some_and(|value| !is_evm_address(value))
    {
        return Err(ApiError::bad_request(
            "tokenContract must be an EVM address",
        ));
    }
    if payload
        .settlement_contract
        .as_deref()
        .is_some_and(|value| !is_evm_address(value))
    {
        return Err(ApiError::bad_request(
            "settlementContract must be an EVM address",
        ));
    }
    if payload
        .recipient_address
        .as_deref()
        .is_some_and(|value| !is_evm_address(value))
    {
        return Err(ApiError::bad_request(
            "recipientAddress must be an EVM address",
        ));
    }
    if let (Some(chain_id), Some(token_contract)) =
        (payload.chain_id, payload.token_contract.as_ref())
    {
        let Some(asset) = overview.evm_asset_balances.iter().find(|asset| {
            asset.chain_id == chain_id && asset.token_contract.eq_ignore_ascii_case(token_contract)
        }) else {
            return Err(ApiError::not_found("token balance not found"));
        };
        if payload.amount_minor_units > asset.withdrawable_minor_units {
            return Err(ApiError::conflict(
                "withdraw amount exceeds available token balance",
            ));
        }
    }
    if overview.withdrawals.iter().any(|withdrawal| {
        withdrawal
            .receipt
            .eq_ignore_ascii_case(&payload.chain_tx_hash)
    }) {
        return Err(ApiError::conflict(
            "withdraw transaction is already projected",
        ));
    }

    state
        .portal
        .create_project_withdrawal(
            &project_id,
            payload.amount_minor_units,
            &payload.chain_tx_hash,
            ProjectWithdrawalScope {
                chain_id: payload.chain_id,
                token_contract: payload
                    .token_contract
                    .as_ref()
                    .map(|value| value.trim().to_string()),
                settlement_contract: payload
                    .settlement_contract
                    .as_ref()
                    .map(|value| value.trim().to_string()),
                recipient_address: payload
                    .recipient_address
                    .as_ref()
                    .map(|value| value.trim().to_string()),
            },
            Utc::now(),
        )
        .await
        .ok_or(ApiError::not_found("project not found"))?;

    state
        .portal
        .project_overview(&project_id)
        .await
        .map(Json)
        .ok_or(ApiError::not_found("project not found"))
}

pub(super) async fn dispatch_project_deliveries(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<WebhookDeliveryRecord>, ApiError> {
    let deliveries = state
        .portal
        .due_webhook_deliveries(project_id, Utc::now())
        .await;
    let mut results = Vec::new();
    for delivery in deliveries {
        results.extend(dispatch_delivery(state, delivery).await?);
    }
    Ok(results)
}

async fn dispatch_delivery(
    state: &AppState,
    delivery: WebhookDeliveryRecord,
) -> Result<Vec<WebhookDeliveryRecord>, ApiError> {
    let event = state
        .portal
        .webhook_event_by_id(&delivery.event_id)
        .await
        .ok_or(ApiError::not_found("webhook event not found"))?;
    let endpoint = state
        .portal
        .webhook_endpoint_by_id(&delivery.endpoint_id)
        .await
        .ok_or(ApiError::not_found("webhook endpoint not found"))?;
    let secrets = state
        .portal
        .active_webhook_secrets_for_endpoint(&endpoint.endpoint_id, Utc::now())
        .await;
    if secrets.is_empty() {
        return Err(ApiError::not_found("webhook secret not found"));
    }
    let raw_body = if event.raw_payload.is_empty() {
        serde_json::to_string(&event.payload)
            .map_err(|_| ApiError::internal("failed to serialize webhook event"))?
    } else {
        event.raw_payload.clone()
    };
    let timestamp = Utc::now().timestamp();
    let timestamp_text = timestamp.to_string();
    let signature = try_sign_webhook_payload_with_secrets(
        &secrets,
        &delivery.delivery_id,
        timestamp,
        &raw_body,
    )
    .map_err(|_| ApiError::internal("webhook endpoint secret is invalid"))?;
    let request_headers = serde_json::json!({
        "content-type": "application/json",
        SVIX_ID_HEADER: delivery.delivery_id,
        "svix-event-id": event.event_id,
        SVIX_TIMESTAMP_HEADER: timestamp_text,
        SVIX_SIGNATURE_HEADER: signature,
    });

    let response = state
        .webhook_client
        .post(&endpoint.url)
        .header("content-type", "application/json")
        .header(SVIX_ID_HEADER, &delivery.delivery_id)
        .header("svix-event-id", &event.event_id)
        .header(SVIX_TIMESTAMP_HEADER, &timestamp_text)
        .header(SVIX_SIGNATURE_HEADER, &signature)
        .body(raw_body)
        .send()
        .await;

    let attempted_at = Utc::now();
    let signature_header = signature.clone();
    let (http_status, response_headers, response_body, error) = match response {
        Ok(response) => {
            let status = response.status().as_u16();
            let response_headers = Some(headers_to_json(response.headers()));
            let body = response.text().await.unwrap_or_default();
            (
                Some(status),
                response_headers,
                Some(truncate_body(body)),
                None,
            )
        }
        Err(error) => (None, None, None, Some(error.to_string())),
    };

    state
        .portal
        .record_webhook_delivery_attempt(WebhookDeliveryAttemptRecord {
            attempt_id: format!("wha_{}", uuid::Uuid::new_v4().simple()),
            delivery_id: delivery.delivery_id.clone(),
            event_id: delivery.event_id.clone(),
            endpoint_id: delivery.endpoint_id.clone(),
            project_id: delivery.project_id.clone(),
            request_headers,
            response_headers,
            http_status,
            response_body: response_body.clone(),
            error: error.clone(),
            attempted_at,
        })
        .await;

    let result = state
        .portal
        .mark_webhook_delivery_result(
            &delivery.delivery_id,
            signature_header,
            http_status,
            response_body,
            error,
            Utc::now(),
        )
        .await
        .ok_or(ApiError::not_found("webhook delivery not found"))?;

    Ok(vec![result])
}

async fn require_session(
    state: &AppState,
    jar: &CookieJar,
) -> Result<storage::StoredSession, ApiError> {
    session_from_cookie(state, jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))
}

async fn owned_overview(
    state: &AppState,
    jar: &CookieJar,
    project_id: &str,
) -> Result<ProjectDashboardOverview, ApiError> {
    let session = require_session(state, jar).await?;
    let overview = state
        .portal
        .project_overview(project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&overview.project, &session.user.address)?;
    Ok(overview)
}

fn require_project_owner(project: &PaymentProject, owner_wallet: &str) -> Result<(), ApiError> {
    if project.owner_wallet.eq_ignore_ascii_case(owner_wallet) {
        return Ok(());
    }

    Err(ApiError::not_found("project not found"))
}

fn is_public_demo_project(project_id: &str) -> bool {
    project_id == public_demo_project_id()
}

fn public_demo_project_id() -> &'static str {
    PUBLIC_DEMO_PROJECT_ID
        .get_or_init(|| {
            std::env::var("ZAMAPAY_PUBLIC_DEMO_PROJECT_ID")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_PUBLIC_DEMO_PROJECT_ID.to_string())
        })
        .as_str()
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let Some(value) = headers.get(header::AUTHORIZATION) else {
        return Err(ApiError::unauthorized("missing bearer project secret"));
    };
    let value = value
        .to_str()
        .map_err(|_| ApiError::unauthorized("invalid bearer project secret"))?;
    value
        .strip_prefix("Bearer ")
        .filter(|token| !token.trim().is_empty())
        .ok_or(ApiError::unauthorized("invalid bearer project secret"))
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiError::bad_request(format!("{name} header is required")))
}

fn validated_webhook_url(url: &str) -> Result<&str, ApiError> {
    let url = url.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(url);
    }

    Err(ApiError::bad_request("webhook URL must be http or https"))
}

fn checkout_error(error: CheckoutSessionError) -> ApiError {
    match error {
        CheckoutSessionError::InvalidRequest => ApiError::bad_request("invalid checkout session"),
        CheckoutSessionError::Locked => ApiError::locked("project invoice authority is locked"),
        CheckoutSessionError::NotFound => ApiError::not_found("checkout session not found"),
        CheckoutSessionError::RailDisabled => {
            ApiError::locked("payment rail is disabled for this project")
        }
        CheckoutSessionError::Unauthorized => ApiError::unauthorized("invalid project secret"),
    }
}

fn parse_payment_rail(value: &str) -> Result<PaymentRail, ApiError> {
    match value {
        "zama_private" => Ok(PaymentRail::ZamaPrivate),
        "evm_erc20" => Ok(PaymentRail::EvmErc20),
        _ => Err(ApiError::bad_request("unknown payment rail")),
    }
}

fn checkout_base_url() -> String {
    runtime_profile::checkout_base_url()
}

fn truncate_body(body: String) -> String {
    const LIMIT: usize = 2048;
    if body.len() <= LIMIT {
        return body;
    }

    format!("{}...", &body[..LIMIT])
}

fn headers_to_json(headers: &reqwest::header::HeaderMap) -> serde_json::Value {
    let mut output = serde_json::Map::new();
    for (name, value) in headers {
        if let Ok(value) = value.to_str() {
            output.insert(
                name.as_str().to_string(),
                serde_json::Value::String(value.to_string()),
            );
        }
    }
    serde_json::Value::Object(output)
}

fn is_transaction_hash(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn is_evm_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}
