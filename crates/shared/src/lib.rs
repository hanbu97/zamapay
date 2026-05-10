pub mod contracts;

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use domain::{
    FinalityStatus, FulfillmentStatus, OperatorSettlementEvent, PaymentTruth, SettlementSnapshot,
    WebhookDeliveryOutcome, WebhookDeliverySnapshot, WebhookDeliveryStatus,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use contracts::{
    AddressManifest, BillingPlanProtocolTerms, BillingProtocolManifest, ContractAddresses,
    contract_manifest, local_dev_contract_manifest, normalize_contract_environment,
};

pub const DEFAULT_FINALITY_THRESHOLD: u64 = 2;

fn default_finality_threshold() -> u64 {
    DEFAULT_FINALITY_THRESHOLD
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonceRequest {
    pub address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NonceResponse {
    pub nonce: String,
    pub message: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub address: String,
    pub nonce: String,
    pub message: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvoiceRequest {
    pub title: String,
    pub amount_label: String,
    pub amount_minor_units: u64,
    pub note: String,
    pub external_ref: Option<String>,
    pub chain_invoice_id: Option<u64>,
    pub chain_tx_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectEnvironmentKind {
    LocalDev,
}

impl ProjectEnvironmentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::LocalDev => "local-dev",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Active,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceAuthorityMode {
    PlatformHostedSigner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckoutSessionStatus {
    Created,
    Open,
    Paid,
    Expired,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingPlan {
    #[default]
    Free,
    Growth,
    Enterprise,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingCycle {
    #[default]
    Monthly,
    Annual,
}

impl BillingPlan {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Growth => "growth",
            Self::Enterprise => "enterprise",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Free => "Free",
            Self::Growth => "Growth",
            Self::Enterprise => "Enterprise",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::Free => "Start with hosted checkout and project API keys.",
            Self::Growth => "Reduce checkout fees for active merchants.",
            Self::Enterprise => "Custom rate and settlement policy for larger teams.",
        }
    }

    pub fn all() -> [Self; 3] {
        [Self::Free, Self::Growth, Self::Enterprise]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingSubscriptionStatus {
    Active,
    PastDue,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingEntitlementStatus {
    #[default]
    #[serde(alias = "local_only")]
    ContractDefault,
    PendingPrivateProof,
    Anchored,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingPlanCatalogEntry {
    pub plan: BillingPlan,
    pub name: String,
    pub plan_code: Option<u16>,
    pub checkout_fee_bps: Option<u16>,
    pub monthly_price_minor_units: Option<u64>,
    pub annual_price_minor_units: Option<u64>,
    pub monthly_price_usd: Option<u32>,
    pub annual_price_usd: Option<u32>,
    pub self_serve: bool,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingSubscription {
    pub subscription_id: String,
    pub owner_wallet: String,
    pub plan: BillingPlan,
    #[serde(default)]
    pub billing_cycle: BillingCycle,
    pub status: BillingSubscriptionStatus,
    #[serde(default)]
    pub pass_id: Option<String>,
    #[serde(default)]
    pub entitlement_version: u64,
    #[serde(default)]
    pub entitlement_status: BillingEntitlementStatus,
    #[serde(default)]
    pub entitlement_tx_hash: Option<String>,
    #[serde(default)]
    pub subscription_check_handle: Option<String>,
    pub current_period_started_at: DateTime<Utc>,
    pub current_period_ends_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl BillingSubscription {
    pub fn effective_plan(&self) -> BillingPlan {
        if self.status != BillingSubscriptionStatus::Active {
            return BillingPlan::Free;
        }

        match self.entitlement_status {
            BillingEntitlementStatus::Anchored => self.plan,
            BillingEntitlementStatus::ContractDefault
            | BillingEntitlementStatus::PendingPrivateProof
            | BillingEntitlementStatus::Rejected => BillingPlan::Free,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingPaymentStatus {
    Succeeded,
    Pending,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingPaymentRecord {
    pub payment_id: String,
    pub owner_wallet: String,
    pub plan: BillingPlan,
    pub billing_cycle: BillingCycle,
    pub amount_minor_units: u64,
    pub currency: String,
    pub status: BillingPaymentStatus,
    #[serde(default)]
    pub chain_tx_hash: Option<String>,
    #[serde(default)]
    pub subscription_check_handle: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingSubscriptionResponse {
    pub subscription: BillingSubscription,
    pub plans: Vec<BillingPlanCatalogEntry>,
    #[serde(default)]
    pub payments: Vec<BillingPaymentRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeBillingSubscriptionRequest {
    pub plan: BillingPlan,
    #[serde(default)]
    pub billing_cycle: BillingCycle,
    #[serde(default)]
    pub pass_id: Option<String>,
    #[serde(default)]
    pub chain_tx_hash: Option<String>,
    #[serde(default)]
    pub subscription_check_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingUpgradeIntentRequest {
    pub plan: BillingPlan,
    #[serde(default)]
    pub billing_cycle: BillingCycle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingUpgradeIntentResponse {
    pub pass_id: Option<String>,
    pub owner_wallet: String,
    pub plan: BillingPlan,
    pub billing_cycle: BillingCycle,
    pub plan_code: u16,
    pub price_minor_units: u64,
    pub period_days: i64,
    pub expected_fee_bps: u16,
    pub charge_token_contract: Option<String>,
    pub subscription_registry_contract: Option<String>,
    pub treasury_wallet: Option<String>,
    pub privacy_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionEntitlementProjectionRequest {
    pub plan: BillingPlan,
    #[serde(default)]
    pub billing_cycle: BillingCycle,
    pub pass_id: String,
    pub entitlement_version: u64,
    pub entitlement_tx_hash: String,
    pub subscription_check_handle: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutBillingSnapshot {
    pub plan: BillingPlan,
    pub fee_bps: u16,
    pub gross_amount_minor_units: u64,
    pub platform_fee_minor_units: u64,
    pub merchant_net_minor_units: u64,
}

impl CheckoutBillingSnapshot {
    pub fn from_gross_amount(
        plan: BillingPlan,
        fee_bps: u16,
        gross_amount_minor_units: u64,
    ) -> Option<Self> {
        if gross_amount_minor_units == 0 {
            return None;
        }

        let platform_fee_minor_units = calculate_platform_fee(gross_amount_minor_units, fee_bps)?;
        let merchant_net_minor_units =
            gross_amount_minor_units.checked_sub(platform_fee_minor_units)?;

        Some(Self {
            plan,
            fee_bps,
            gross_amount_minor_units,
            platform_fee_minor_units,
            merchant_net_minor_units,
        })
    }
}

fn calculate_platform_fee(gross_amount_minor_units: u64, fee_bps: u16) -> Option<u64> {
    let fee = (u128::from(gross_amount_minor_units) * u128::from(fee_bps)).div_ceil(10_000);
    u64::try_from(fee).ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentProject {
    pub project_id: String,
    pub name: String,
    pub owner_wallet: String,
    pub default_environment: ProjectEnvironmentKind,
    #[serde(default)]
    pub billing_plan: BillingPlan,
    pub status: ProjectStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentProjectEnvironment {
    pub environment_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub chain_id: Option<u64>,
    pub settlement_contract: Option<String>,
    pub token_contract: Option<String>,
    pub invoice_authority_id: String,
    pub status: ProjectStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInvoiceAuthority {
    pub authority_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub mode: InvoiceAuthorityMode,
    pub signer_address: String,
    pub key_ref: String,
    pub merchant_registered: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectApiKey {
    pub key_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub label: String,
    pub prefix: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWebhookEndpoint {
    pub endpoint_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub url: String,
    pub enabled: bool,
    pub secret_preview: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSession {
    pub checkout_session_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub merchant_order_id: String,
    pub idempotency_key: String,
    pub invoice_id: String,
    pub chain_invoice_id: u64,
    pub chain_tx_hash: String,
    pub checkout_url: String,
    pub title: String,
    pub amount_label: String,
    pub amount_minor_units: u64,
    #[serde(default)]
    pub billing: CheckoutBillingSnapshot,
    pub note: String,
    pub success_url: Option<String>,
    pub cancel_url: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub status: CheckoutSessionStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSessionResponse {
    #[serde(flatten)]
    pub session: CheckoutSession,
    pub merchant_owner_wallet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEventRecord {
    pub event_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub event_type: String,
    pub subject_type: String,
    pub subject_id: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryRecord {
    pub delivery_id: String,
    pub event_id: String,
    pub endpoint_id: String,
    pub project_id: String,
    pub environment: ProjectEnvironmentKind,
    pub attempt_count: u32,
    pub status: WebhookDeliveryStatus,
    pub signature_header: Option<String>,
    pub http_status: Option<u16>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub next_retry_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub delivered_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWithdrawalStatus {
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWithdrawalRecord {
    pub withdrawal_id: String,
    pub project_id: String,
    pub amount_minor_units: u64,
    pub status: ProjectWithdrawalStatus,
    pub receipt: String,
    pub created_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectWithdrawalRequest {
    pub amount_minor_units: u64,
    pub chain_tx_hash: String,
    #[serde(default)]
    pub recipient_address: Option<String>,
    #[serde(default)]
    pub settlement_bucket_commitment: Option<String>,
    #[serde(default)]
    pub withdrawal_nonce: Option<String>,
    #[serde(default)]
    pub withdraw_check_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentProjectRequest {
    pub name: String,
    pub environment: Option<ProjectEnvironmentKind>,
    pub billing_plan: Option<BillingPlan>,
    pub webhook_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentProjectResponse {
    pub project: PaymentProject,
    pub environment: PaymentProjectEnvironment,
    pub invoice_authority: ProjectInvoiceAuthority,
    pub webhook_endpoint: Option<ProjectWebhookEndpoint>,
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectApiKeyRequest {
    pub label: Option<String>,
    pub environment: Option<ProjectEnvironmentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectApiKeyResponse {
    pub api_key: String,
    pub key_record: ProjectApiKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureWebhookEndpointRequest {
    pub url: String,
    pub environment: Option<ProjectEnvironmentKind>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureWebhookEndpointResponse {
    pub endpoint: ProjectWebhookEndpoint,
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionRequest {
    pub merchant_order_id: String,
    pub title: String,
    pub amount_label: String,
    pub amount_minor_units: u64,
    pub note: String,
    pub success_url: Option<String>,
    pub cancel_url: Option<String>,
    pub chain_invoice_id: Option<u64>,
    pub chain_tx_hash: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutQuoteRequest {
    pub amount_minor_units: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutQuoteResponse {
    pub billing: CheckoutBillingSnapshot,
    pub merchant_owner_wallet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDashboardSummary {
    pub total_checkouts: u32,
    pub open_checkouts: u32,
    pub paid_checkouts: u32,
    pub gross_volume_minor_units: u64,
    pub platform_fee_minor_units: u64,
    pub merchant_net_minor_units: u64,
    pub withdrawn_minor_units: u64,
    pub withdrawable_minor_units: u64,
    pub pending_deliveries: u32,
    pub delivered_webhooks: u32,
    pub failed_webhooks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDashboardOverview {
    pub project: PaymentProject,
    pub environments: Vec<PaymentProjectEnvironment>,
    pub api_keys: Vec<ProjectApiKey>,
    pub webhook_endpoints: Vec<ProjectWebhookEndpoint>,
    pub checkout_sessions: Vec<CheckoutSession>,
    pub webhook_events: Vec<WebhookEventRecord>,
    pub webhook_deliveries: Vec<WebhookDeliveryRecord>,
    pub withdrawals: Vec<ProjectWithdrawalRecord>,
    pub summary: ProjectDashboardSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentProjectionRequest {
    pub chain_invoice_id: Option<u64>,
    pub payment_tx_hash: String,
    pub payer_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentConfirmationsRequest {
    pub confirmations: u64,
    pub finality_threshold: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorSettlementEventRequest {
    pub event: OperatorSettlementEvent,
    pub finality_threshold: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecryptCallbackOutcome {
    Completed,
    FailedTimeout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecryptCallbackRequest {
    pub outcome: DecryptCallbackOutcome,
    pub callback_sender: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecryptRequestSnapshot {
    pub request_id: String,
    pub requested_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub callback_sender: Option<String>,
    pub replayed_callback_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryRequest {
    pub outcome: WebhookDeliveryOutcome,
    pub max_attempts: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEventPayload {
    pub event: String,
    pub invoice_id: String,
    pub chain_invoice_id: u64,
    pub payment_tx_hash: Option<String>,
    pub payer_address: Option<String>,
    pub amount_minor_units: u64,
    pub amount_label: String,
    pub payment_truth: PaymentTruth,
    pub finality_status: FinalityStatus,
    pub fulfillment_status: FulfillmentStatus,
    pub webhook_attempt_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookSignatureHeaders {
    #[serde(rename = "x-mermer-webhook-id")]
    pub x_mermer_webhook_id: String,
    #[serde(rename = "x-mermer-webhook-timestamp")]
    pub x_mermer_webhook_timestamp: String,
    #[serde(rename = "x-mermer-webhook-signature")]
    pub x_mermer_webhook_signature: String,
    #[serde(rename = "x-mermer-webhook-algorithm")]
    pub x_mermer_webhook_algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDispatchResponse {
    pub endpoint: String,
    pub headers: WebhookSignatureHeaders,
    pub payload: WebhookEventPayload,
    pub canonical_body: String,
    pub signature_base: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FulfillmentArtifact {
    pub label: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FulfillmentReleaseAudit {
    pub invoice_id: String,
    pub job_id: String,
    pub released_at: DateTime<Utc>,
    pub artifact_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FulfillmentResponse {
    pub invoice_id: String,
    pub decision: String,
    pub artifacts: Vec<FulfillmentArtifact>,
    pub release: Option<FulfillmentReleaseAudit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUser {
    pub address: String,
    pub session_id: Uuid,
    pub issued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub authenticated: bool,
    pub user: Option<SessionUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRecord {
    pub invoice_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub checkout_session_id: Option<String>,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub external_ref: Option<String>,
    pub title: String,
    pub merchant_name: String,
    pub amount_label: String,
    pub amount_minor_units: u64,
    #[serde(default)]
    pub billing: Option<CheckoutBillingSnapshot>,
    pub note: String,
    pub chain_invoice_id: Option<u64>,
    pub chain_tx_hash: Option<String>,
    pub payment_tx_hash: Option<String>,
    pub payer_address: Option<String>,
    #[serde(default)]
    pub finality_confirmations: u64,
    #[serde(default = "default_finality_threshold")]
    pub finality_threshold: u64,
    #[serde(default)]
    pub webhook: WebhookDeliverySnapshot,
    #[serde(default)]
    pub fulfillment_release: Option<FulfillmentReleaseAudit>,
    #[serde(default)]
    pub decrypt_request: Option<DecryptRequestSnapshot>,
    #[serde(default)]
    pub decrypt_pending_guard_trips: u32,
    pub snapshot: SettlementSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub total_invoices: u32,
    pub paid_invoices: u32,
    pub pending_invoices: u32,
    pub finality_backlog: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardOverview {
    pub merchant_name: String,
    pub merchant_address: String,
    pub summary: DashboardSummary,
    pub invoices: Vec<InvoiceRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexerCursor {
    pub latest_chain_invoice_id: Option<u64>,
    pub latest_payment_tx_hash: Option<String>,
    pub indexed_invoices: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperatorDiagnostics {
    pub chain_sync_status: String,
    pub indexer_cursor: IndexerCursor,
    pub indexer_stalled: bool,
    pub pending_decrypt_jobs: u32,
    pub pending_finality_backlog: u32,
    pub pending_webhooks: u32,
    pub retrying_webhooks: u32,
    pub failed_webhooks: u32,
    pub expired_invoices: u32,
    pub operator_auth_rejections: u32,
    pub decrypt_pending_guard_trips: u32,
    pub decrypt_timeouts: u32,
    pub replay_guard_failures: u32,
    pub reorg_exceptions: u32,
    pub frozen_fulfillments: u32,
    pub release_failures: u32,
    pub operator_action_required: bool,
    pub invoices: Vec<InvoiceRecord>,
}
