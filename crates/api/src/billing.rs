use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use shared::{
    BillingSubscriptionResponse, BillingUpgradeIntentRequest, BillingUpgradeIntentResponse,
    SubscriptionEntitlementProjectionRequest, UpgradeBillingSubscriptionRequest,
    local_dev_contract_manifest,
};
use storage::BillingSubscriptionError;

use super::{ApiError, AppState, normalize_address, require_operator_key, session_from_cookie};

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/billing/subscription", get(current_subscription))
        .route(
            "/api/billing/subscription/upgrade-intent",
            post(upgrade_intent),
        )
        .route(
            "/api/billing/subscription/upgrade",
            post(upgrade_subscription),
        )
        .route(
            "/api/operator/subscription-entitlements/{owner_wallet}/projection",
            post(project_subscription_entitlement),
        )
}

async fn current_subscription(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<BillingSubscriptionResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let manifest = active_manifest()?;

    Ok(Json(
        state
            .portal
            .billing_subscription_for_manifest(
                &session.user.address,
                Some(&manifest),
                chrono::Utc::now(),
            )
            .await,
    ))
}

async fn upgrade_intent(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<BillingUpgradeIntentRequest>,
) -> Result<Json<BillingUpgradeIntentResponse>, ApiError> {
    let session = require_session(&state, &jar).await?;
    let manifest = active_manifest()?;
    let intent = state
        .portal
        .billing_upgrade_intent(
            &session.user.address,
            payload.plan,
            payload.billing_cycle,
            Some(&manifest),
            chrono::Utc::now(),
        )
        .await
        .map_err(|_| {
            ApiError::locked("billing terms are not available in the active contract manifest")
        })?;

    Ok(Json(intent))
}

async fn upgrade_subscription(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(_payload): Json<UpgradeBillingSubscriptionRequest>,
) -> Result<Json<BillingSubscriptionResponse>, ApiError> {
    let _session = require_session(&state, &jar).await?;
    Err(ApiError::locked(
        "subscription upgrades are finalized on chain; the web client reads PrivateSubscriptionRegistry directly",
    ))
}

async fn project_subscription_entitlement(
    State(state): State<AppState>,
    Path(owner_wallet): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<SubscriptionEntitlementProjectionRequest>,
) -> Result<Json<BillingSubscriptionResponse>, ApiError> {
    require_operator_key(&state, &headers).await?;
    let owner_wallet = normalize_address(&owner_wallet)?;
    let manifest = active_manifest()?;
    let subscription = state
        .portal
        .project_subscription_entitlement(
            &owner_wallet,
            payload,
            Some(&manifest),
            chrono::Utc::now(),
        )
        .await
        .map_err(billing_projection_error)?;

    Ok(Json(subscription))
}

fn billing_projection_error(error: BillingSubscriptionError) -> ApiError {
    match error {
        BillingSubscriptionError::PlanRequiresReview => ApiError::locked(
            "subscription plan requires review or is not available in the active contract manifest",
        ),
        BillingSubscriptionError::ChainSourceOnly => ApiError::locked(
            "subscription upgrades are finalized on chain; operator projection requires anchored chain evidence",
        ),
        BillingSubscriptionError::InvalidProjection => {
            ApiError::bad_request("subscription projection requires non-empty chain evidence")
        }
    }
}

fn active_manifest() -> Result<shared::AddressManifest, ApiError> {
    local_dev_contract_manifest()
        .map_err(|_| ApiError::internal("generated local-dev contract manifest is invalid"))
}

async fn require_session(
    state: &AppState,
    jar: &CookieJar,
) -> Result<storage::StoredSession, ApiError> {
    session_from_cookie(state, jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))
}
