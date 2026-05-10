use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use shared::{
    CheckoutQuoteRequest, CheckoutQuoteResponse, CheckoutSession, CheckoutSessionResponse,
    ConfigureWebhookEndpointRequest, CreateCheckoutSessionRequest, CreatePaymentProjectRequest,
    CreateProjectApiKeyRequest, CreateProjectWithdrawalRequest, PaymentProject,
    ProjectDashboardOverview, ProjectEnvironmentKind, WebhookDeliveryRecord, WebhookEventRecord,
};
use storage::CheckoutSessionError;

use super::{ApiError, AppState, keyed_digest, session_from_cookie};

const DEFAULT_CHECKOUT_BASE_URL: &str = "http://127.0.0.1:3001";
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/{project_id}", get(project_overview))
        .route(
            "/api/projects/{project_id}/api-keys",
            post(create_project_api_key),
        )
        .route(
            "/api/projects/{project_id}/api-keys/{key_id}/revoke",
            post(revoke_project_api_key),
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
    let subscription = state
        .portal
        .billing_subscription(&session.user.address, now)
        .await;
    let effective_plan = subscription.subscription.effective_plan();
    if payload
        .billing_plan
        .is_some_and(|requested| requested != effective_plan)
    {
        return Err(ApiError::forbidden(
            "project billing plan comes from the active subscription; upgrade before using a paid rate",
        ));
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
    let session = require_session(&state, &jar).await?;
    let overview = state
        .portal
        .project_overview(&project_id)
        .await
        .ok_or(ApiError::not_found("project not found"))?;
    require_project_owner(&overview.project, &session.user.address)?;
    Ok(Json(overview))
}

async fn create_project_api_key(
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
    let label = payload.label.as_deref().unwrap_or("Default API key").trim();
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

async fn revoke_project_api_key(
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
        .ok_or(ApiError::not_found("api key not found"))?;
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

    Ok(Json(CheckoutSessionResponse {
        session: checkout,
        merchant_owner_wallet: project.owner_wallet,
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
    let secret = state
        .portal
        .webhook_secret_for_endpoint(&endpoint.endpoint_id)
        .await
        .ok_or(ApiError::not_found("webhook secret not found"))?;
    let canonical_body = serde_json::to_string(&event.payload)
        .map_err(|_| ApiError::internal("failed to serialize webhook event"))?;
    let timestamp = Utc::now().to_rfc3339();
    let signature_base = format!("{}.{}.{}", delivery.delivery_id, timestamp, canonical_body);
    let signature = format!("v1={}", keyed_digest(&secret, &signature_base));

    let response = state
        .webhook_client
        .post(&endpoint.url)
        .header("content-type", "application/json")
        .header("x-zamapay-webhook-id", &delivery.delivery_id)
        .header("x-zamapay-event-id", &event.event_id)
        .header("x-zamapay-webhook-timestamp", &timestamp)
        .header("x-zamapay-webhook-signature", &signature)
        .header("x-zamapay-webhook-algorithm", "keccak256.secret_prefix.v1")
        .body(canonical_body)
        .send()
        .await;

    let signature_header = signature;
    let result = match response {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            state
                .portal
                .mark_webhook_delivery_result(
                    &delivery.delivery_id,
                    signature_header,
                    Some(status),
                    Some(truncate_body(body)),
                    None,
                    Utc::now(),
                )
                .await
        }
        Err(error) => {
            state
                .portal
                .mark_webhook_delivery_result(
                    &delivery.delivery_id,
                    signature_header,
                    None,
                    None,
                    Some(error.to_string()),
                    Utc::now(),
                )
                .await
        }
    }
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

fn bearer_token(headers: &HeaderMap) -> Result<&str, ApiError> {
    let Some(value) = headers.get(header::AUTHORIZATION) else {
        return Err(ApiError::unauthorized("missing bearer API key"));
    };
    let value = value
        .to_str()
        .map_err(|_| ApiError::unauthorized("invalid bearer API key"))?;
    value
        .strip_prefix("Bearer ")
        .filter(|token| !token.trim().is_empty())
        .ok_or(ApiError::unauthorized("invalid bearer API key"))
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
        CheckoutSessionError::Unauthorized => ApiError::unauthorized("invalid project API key"),
    }
}

fn checkout_base_url() -> String {
    std::env::var("ZAMAPAY_CHECKOUT_BASE_URL")
        .or_else(|_| std::env::var("NEXT_PUBLIC_APP_URL"))
        .unwrap_or_else(|_| DEFAULT_CHECKOUT_BASE_URL.to_string())
}

fn truncate_body(body: String) -> String {
    const LIMIT: usize = 2048;
    if body.len() <= LIMIT {
        return body;
    }

    format!("{}...", &body[..LIMIT])
}

fn is_transaction_hash(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}
