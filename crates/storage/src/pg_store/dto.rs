use std::collections::{BTreeMap, HashMap};

use chrono::{DateTime, Utc};
use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, PaymentTruth, SettlementSnapshot,
    WebhookDeliverySnapshot, WebhookDeliveryStatus,
};
use sea_orm::FromQueryResult;
use serde::{Serialize, de::DeserializeOwned};
use shared::{
    BillingCycle, BillingEntitlementStatus, BillingPaymentRecord, BillingPaymentStatus,
    BillingPlan, BillingSubscription, BillingSubscriptionStatus, CheckoutBillingSnapshot,
    CheckoutSession, CheckoutSessionStatus, DecryptRequestSnapshot, FulfillmentReleaseAudit,
    InvoiceAuthorityMode, InvoiceRecord, PaymentProject, PaymentProjectEnvironment, ProjectApiKey,
    ProjectEnvironmentKind, ProjectInvoiceAuthority, ProjectStatus, ProjectWebhookEndpoint,
    ProjectWithdrawalRecord, ProjectWithdrawalStatus, WebhookDeliveryRecord, WebhookEventRecord,
};

use crate::project_support::StoredProjectApiKey;

#[derive(Clone)]
pub(crate) struct PortalRecordSet {
    pub(crate) invoices: HashMap<String, InvoiceRecord>,
    pub(crate) projects: HashMap<String, PaymentProject>,
    pub(crate) subscriptions: HashMap<String, BillingSubscription>,
    pub(crate) billing_payments: HashMap<String, Vec<BillingPaymentRecord>>,
    pub(crate) environments: HashMap<String, PaymentProjectEnvironment>,
    pub(crate) invoice_authorities: HashMap<String, ProjectInvoiceAuthority>,
    pub(crate) api_keys: HashMap<String, StoredProjectApiKey>,
    pub(crate) webhook_endpoints: HashMap<String, ProjectWebhookEndpoint>,
    pub(crate) checkout_sessions: HashMap<String, CheckoutSession>,
    pub(crate) idempotency_keys: HashMap<String, String>,
    pub(crate) webhook_events: HashMap<String, WebhookEventRecord>,
    pub(crate) webhook_deliveries: HashMap<String, WebhookDeliveryRecord>,
    pub(crate) project_withdrawals: HashMap<String, ProjectWithdrawalRecord>,
    pub(crate) next_invoice_number: u64,
    pub(crate) next_chain_invoice_id: u64,
}

impl Default for PortalRecordSet {
    fn default() -> Self {
        Self {
            invoices: HashMap::new(),
            projects: HashMap::new(),
            subscriptions: HashMap::new(),
            billing_payments: HashMap::new(),
            environments: HashMap::new(),
            invoice_authorities: HashMap::new(),
            api_keys: HashMap::new(),
            webhook_endpoints: HashMap::new(),
            checkout_sessions: HashMap::new(),
            idempotency_keys: HashMap::new(),
            webhook_events: HashMap::new(),
            webhook_deliveries: HashMap::new(),
            project_withdrawals: HashMap::new(),
            next_invoice_number: 1,
            next_chain_invoice_id: 1,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct CounterRow {
    pub(crate) next_invoice_number: i64,
    pub(crate) next_chain_invoice_id: i64,
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct InvoiceRow {
    pub(crate) invoice_id: String,
    pub(crate) project_id: Option<String>,
    pub(crate) checkout_session_id: Option<String>,
    pub(crate) environment: Option<String>,
    pub(crate) external_ref: Option<String>,
    pub(crate) title: String,
    pub(crate) merchant_name: String,
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: i64,
    pub(crate) note: String,
    pub(crate) chain_invoice_id: Option<i64>,
    pub(crate) chain_tx_hash: Option<String>,
    pub(crate) payment_tx_hash: Option<String>,
    pub(crate) payer_address: Option<String>,
    pub(crate) finality_confirmations: i64,
    pub(crate) finality_threshold: i64,
    pub(crate) webhook_status: String,
    pub(crate) webhook_attempt_count: i32,
    pub(crate) webhook_next_retry_after_seconds: Option<i32>,
    pub(crate) fulfillment_job_id: Option<String>,
    pub(crate) fulfillment_released_at: Option<DateTime<Utc>>,
    pub(crate) fulfillment_artifact_count: Option<i32>,
    pub(crate) decrypt_request_id: Option<String>,
    pub(crate) decrypt_requested_at: Option<DateTime<Utc>>,
    pub(crate) decrypt_completed_at: Option<DateTime<Utc>>,
    pub(crate) decrypt_callback_sender: Option<String>,
    pub(crate) decrypt_replayed_callback_count: i32,
    pub(crate) decrypt_pending_guard_trips: i32,
    pub(crate) settlement_invoice_id: i64,
    pub(crate) payment_truth: String,
    pub(crate) finality_status: String,
    pub(crate) decrypt_job_status: String,
    pub(crate) fulfillment_status: String,
    pub(crate) billing_plan: Option<String>,
    pub(crate) billing_fee_bps: Option<i32>,
    pub(crate) billing_gross_amount_minor_units: Option<i64>,
    pub(crate) billing_platform_fee_minor_units: Option<i64>,
    pub(crate) billing_merchant_net_minor_units: Option<i64>,
}

impl InvoiceRow {
    pub(crate) fn into_domain(self) -> InvoiceRecord {
        let invoice_id = self.invoice_id;
        InvoiceRecord {
            invoice_id: invoice_id.clone(),
            project_id: self.project_id,
            checkout_session_id: self.checkout_session_id,
            environment: self.environment,
            external_ref: self.external_ref,
            title: self.title,
            merchant_name: self.merchant_name,
            amount_label: self.amount_label,
            amount_minor_units: u64_from_i64(self.amount_minor_units, "invoice.amount_minor_units"),
            billing: billing_from_columns(
                self.billing_plan,
                self.billing_fee_bps,
                self.billing_gross_amount_minor_units,
                self.billing_platform_fee_minor_units,
                self.billing_merchant_net_minor_units,
            ),
            note: self.note,
            chain_invoice_id: self
                .chain_invoice_id
                .map(|value| u64_from_i64(value, "invoice.chain_invoice_id")),
            chain_tx_hash: self.chain_tx_hash,
            payment_tx_hash: self.payment_tx_hash,
            payer_address: self.payer_address,
            finality_confirmations: u64_from_i64(
                self.finality_confirmations,
                "invoice.finality_confirmations",
            ),
            finality_threshold: u64_from_i64(self.finality_threshold, "invoice.finality_threshold"),
            webhook: WebhookDeliverySnapshot {
                status: decode_enum(&self.webhook_status),
                attempt_count: u32_from_i32(self.webhook_attempt_count, "invoice.webhook_attempt"),
                next_retry_after_seconds: self
                    .webhook_next_retry_after_seconds
                    .map(|value| u32_from_i32(value, "invoice.webhook_retry")),
            },
            fulfillment_release: self
                .fulfillment_job_id
                .map(|job_id| FulfillmentReleaseAudit {
                    invoice_id: invoice_id.clone(),
                    job_id,
                    released_at: self
                        .fulfillment_released_at
                        .expect("fulfillment release timestamp is required"),
                    artifact_count: u32_from_i32(
                        self.fulfillment_artifact_count
                            .expect("fulfillment artifact count is required"),
                        "invoice.fulfillment_artifact_count",
                    ),
                }),
            decrypt_request: self
                .decrypt_request_id
                .map(|request_id| DecryptRequestSnapshot {
                    request_id,
                    requested_at: self
                        .decrypt_requested_at
                        .expect("decrypt request timestamp is required"),
                    completed_at: self.decrypt_completed_at,
                    callback_sender: self.decrypt_callback_sender,
                    replayed_callback_count: u32_from_i32(
                        self.decrypt_replayed_callback_count,
                        "invoice.decrypt_replayed_callback_count",
                    ),
                }),
            decrypt_pending_guard_trips: u32_from_i32(
                self.decrypt_pending_guard_trips,
                "invoice.decrypt_pending_guard_trips",
            ),
            snapshot: SettlementSnapshot {
                invoice_id: u64_from_i64(
                    self.settlement_invoice_id,
                    "invoice.settlement_invoice_id",
                ),
                payment_truth: decode_enum(&self.payment_truth),
                finality_status: decode_enum(&self.finality_status),
                decrypt_job_status: decode_enum(&self.decrypt_job_status),
                fulfillment_status: decode_enum(&self.fulfillment_status),
            },
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct ProjectRow {
    pub(crate) project_id: String,
    pub(crate) name: String,
    pub(crate) owner_wallet: String,
    pub(crate) default_environment: String,
    pub(crate) billing_plan: String,
    pub(crate) status: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

impl ProjectRow {
    pub(crate) fn into_domain(self) -> PaymentProject {
        PaymentProject {
            project_id: self.project_id,
            name: self.name,
            owner_wallet: self.owner_wallet,
            default_environment: decode_enum(&self.default_environment),
            billing_plan: decode_enum(&self.billing_plan),
            status: decode_enum(&self.status),
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct EnvironmentRow {
    pub(crate) environment_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) chain_id: Option<i64>,
    pub(crate) settlement_contract: Option<String>,
    pub(crate) token_contract: Option<String>,
    pub(crate) invoice_authority_id: String,
    pub(crate) status: String,
}

impl EnvironmentRow {
    pub(crate) fn into_domain(self) -> PaymentProjectEnvironment {
        PaymentProjectEnvironment {
            environment_id: self.environment_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            chain_id: self
                .chain_id
                .map(|value| u64_from_i64(value, "environment.chain_id")),
            settlement_contract: self.settlement_contract,
            token_contract: self.token_contract,
            invoice_authority_id: self.invoice_authority_id,
            status: decode_enum(&self.status),
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct AuthorityRow {
    pub(crate) authority_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) mode: String,
    pub(crate) signer_address: String,
    pub(crate) key_ref: String,
    pub(crate) merchant_registered: bool,
    pub(crate) created_at: DateTime<Utc>,
}

impl AuthorityRow {
    pub(crate) fn into_domain(self) -> ProjectInvoiceAuthority {
        ProjectInvoiceAuthority {
            authority_id: self.authority_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            mode: decode_enum(&self.mode),
            signer_address: self.signer_address,
            key_ref: self.key_ref,
            merchant_registered: self.merchant_registered,
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct ApiKeyRow {
    pub(crate) key_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) label: String,
    pub(crate) prefix: String,
    pub(crate) secret_hash: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) last_used_at: Option<DateTime<Utc>>,
    pub(crate) revoked_at: Option<DateTime<Utc>>,
}

impl ApiKeyRow {
    pub(crate) fn into_domain(self) -> StoredProjectApiKey {
        StoredProjectApiKey {
            record: ProjectApiKey {
                key_id: self.key_id,
                project_id: self.project_id,
                environment: decode_enum(&self.environment),
                label: self.label,
                prefix: self.prefix,
                created_at: self.created_at,
                last_used_at: self.last_used_at,
                revoked_at: self.revoked_at,
            },
            secret_hash: self.secret_hash,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct WebhookEndpointRow {
    pub(crate) endpoint_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) url: String,
    pub(crate) enabled: bool,
    pub(crate) secret_preview: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

impl WebhookEndpointRow {
    pub(crate) fn into_domain(self) -> ProjectWebhookEndpoint {
        ProjectWebhookEndpoint {
            endpoint_id: self.endpoint_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            url: self.url,
            enabled: self.enabled,
            secret_preview: self.secret_preview,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct CheckoutRow {
    pub(crate) checkout_session_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) merchant_order_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) invoice_id: String,
    pub(crate) chain_invoice_id: i64,
    pub(crate) chain_tx_hash: String,
    pub(crate) checkout_url: String,
    pub(crate) title: String,
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: i64,
    pub(crate) billing_plan: String,
    pub(crate) billing_fee_bps: i32,
    pub(crate) billing_gross_amount_minor_units: i64,
    pub(crate) billing_platform_fee_minor_units: i64,
    pub(crate) billing_merchant_net_minor_units: i64,
    pub(crate) note: String,
    pub(crate) success_url: Option<String>,
    pub(crate) cancel_url: Option<String>,
    pub(crate) status: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) expires_at: DateTime<Utc>,
}

impl CheckoutRow {
    pub(crate) fn into_domain(self, metadata: BTreeMap<String, String>) -> CheckoutSession {
        CheckoutSession {
            checkout_session_id: self.checkout_session_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            merchant_order_id: self.merchant_order_id,
            idempotency_key: self.idempotency_key,
            invoice_id: self.invoice_id,
            chain_invoice_id: u64_from_i64(self.chain_invoice_id, "checkout.chain_invoice_id"),
            chain_tx_hash: self.chain_tx_hash,
            checkout_url: self.checkout_url,
            title: self.title,
            amount_label: self.amount_label,
            amount_minor_units: u64_from_i64(
                self.amount_minor_units,
                "checkout.amount_minor_units",
            ),
            billing: CheckoutBillingSnapshot {
                plan: decode_enum(&self.billing_plan),
                fee_bps: u16_from_i32(self.billing_fee_bps, "checkout.billing_fee_bps"),
                gross_amount_minor_units: u64_from_i64(
                    self.billing_gross_amount_minor_units,
                    "checkout.billing_gross_amount",
                ),
                platform_fee_minor_units: u64_from_i64(
                    self.billing_platform_fee_minor_units,
                    "checkout.billing_platform_fee",
                ),
                merchant_net_minor_units: u64_from_i64(
                    self.billing_merchant_net_minor_units,
                    "checkout.billing_merchant_net",
                ),
            },
            note: self.note,
            success_url: self.success_url,
            cancel_url: self.cancel_url,
            metadata,
            status: decode_enum(&self.status),
            created_at: self.created_at,
            updated_at: self.updated_at,
            expires_at: self.expires_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct CheckoutMetadataRow {
    pub(crate) checkout_session_id: String,
    pub(crate) metadata_key: String,
    pub(crate) metadata_value: String,
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct IdempotencyRow {
    pub(crate) scope: String,
    pub(crate) checkout_session_id: String,
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct WebhookEventRow {
    pub(crate) event_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) event_type: String,
    pub(crate) subject_type: String,
    pub(crate) subject_id: String,
    pub(crate) payload_text: String,
    pub(crate) created_at: DateTime<Utc>,
}

impl WebhookEventRow {
    pub(crate) fn into_domain(self) -> WebhookEventRecord {
        WebhookEventRecord {
            event_id: self.event_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            event_type: self.event_type,
            subject_type: self.subject_type,
            subject_id: self.subject_id,
            payload: serde_json::from_str(&self.payload_text)
                .expect("webhook event payload should be valid JSON text"),
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct WebhookDeliveryRow {
    pub(crate) delivery_id: String,
    pub(crate) event_id: String,
    pub(crate) endpoint_id: String,
    pub(crate) project_id: String,
    pub(crate) environment: String,
    pub(crate) attempt_count: i32,
    pub(crate) status: String,
    pub(crate) signature_header: Option<String>,
    pub(crate) http_status: Option<i32>,
    pub(crate) response_body: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) next_retry_at: Option<DateTime<Utc>>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) delivered_at: Option<DateTime<Utc>>,
}

impl WebhookDeliveryRow {
    pub(crate) fn into_domain(self) -> WebhookDeliveryRecord {
        WebhookDeliveryRecord {
            delivery_id: self.delivery_id,
            event_id: self.event_id,
            endpoint_id: self.endpoint_id,
            project_id: self.project_id,
            environment: decode_enum(&self.environment),
            attempt_count: u32_from_i32(self.attempt_count, "webhook_delivery.attempt_count"),
            status: decode_enum(&self.status),
            signature_header: self.signature_header,
            http_status: self
                .http_status
                .map(|value| u16_from_i32(value, "webhook_delivery.http_status")),
            response_body: self.response_body,
            error: self.error,
            next_retry_at: self.next_retry_at,
            created_at: self.created_at,
            delivered_at: self.delivered_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct WithdrawalRow {
    pub(crate) withdrawal_id: String,
    pub(crate) project_id: String,
    pub(crate) amount_minor_units: i64,
    pub(crate) status: String,
    pub(crate) receipt: String,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) completed_at: DateTime<Utc>,
}

impl WithdrawalRow {
    pub(crate) fn into_domain(self) -> ProjectWithdrawalRecord {
        ProjectWithdrawalRecord {
            withdrawal_id: self.withdrawal_id,
            project_id: self.project_id,
            amount_minor_units: u64_from_i64(
                self.amount_minor_units,
                "withdrawal.amount_minor_units",
            ),
            status: decode_enum(&self.status),
            receipt: self.receipt,
            created_at: self.created_at,
            completed_at: self.completed_at,
        }
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct SubscriptionRow {
    pub(crate) owner_wallet_key: String,
    pub(crate) subscription_id: String,
    pub(crate) owner_wallet: String,
    pub(crate) plan: String,
    pub(crate) billing_cycle: String,
    pub(crate) status: String,
    pub(crate) pass_id: Option<String>,
    pub(crate) entitlement_version: i64,
    pub(crate) entitlement_status: String,
    pub(crate) entitlement_tx_hash: Option<String>,
    pub(crate) subscription_check_handle: Option<String>,
    pub(crate) current_period_started_at: DateTime<Utc>,
    pub(crate) current_period_ends_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

impl SubscriptionRow {
    pub(crate) fn into_domain(self) -> (String, BillingSubscription) {
        (
            self.owner_wallet_key,
            BillingSubscription {
                subscription_id: self.subscription_id,
                owner_wallet: self.owner_wallet,
                plan: decode_enum(&self.plan),
                billing_cycle: decode_enum(&self.billing_cycle),
                status: decode_enum(&self.status),
                pass_id: self.pass_id,
                entitlement_version: u64_from_i64(
                    self.entitlement_version,
                    "subscription.entitlement_version",
                ),
                entitlement_status: decode_enum(&self.entitlement_status),
                entitlement_tx_hash: self.entitlement_tx_hash,
                subscription_check_handle: self.subscription_check_handle,
                current_period_started_at: self.current_period_started_at,
                current_period_ends_at: self.current_period_ends_at,
                updated_at: self.updated_at,
            },
        )
    }
}

#[derive(Debug, FromQueryResult)]
pub(crate) struct BillingPaymentRow {
    pub(crate) owner_wallet_key: String,
    pub(crate) payment_id: String,
    pub(crate) owner_wallet: String,
    pub(crate) plan: String,
    pub(crate) billing_cycle: String,
    pub(crate) amount_minor_units: i64,
    pub(crate) currency: String,
    pub(crate) status: String,
    pub(crate) chain_tx_hash: Option<String>,
    pub(crate) subscription_check_handle: Option<String>,
    pub(crate) created_at: DateTime<Utc>,
}

impl BillingPaymentRow {
    pub(crate) fn into_domain(self) -> (String, BillingPaymentRecord) {
        (
            self.owner_wallet_key,
            BillingPaymentRecord {
                payment_id: self.payment_id,
                owner_wallet: self.owner_wallet,
                plan: decode_enum(&self.plan),
                billing_cycle: decode_enum(&self.billing_cycle),
                amount_minor_units: u64_from_i64(
                    self.amount_minor_units,
                    "billing_payment.amount_minor_units",
                ),
                currency: self.currency,
                status: decode_enum(&self.status),
                chain_tx_hash: self.chain_tx_hash,
                subscription_check_handle: self.subscription_check_handle,
                created_at: self.created_at,
            },
        )
    }
}

pub(crate) fn encode_enum<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value).expect("enum should serialize") {
        serde_json::Value::String(value) => value,
        _ => panic!("enum should serialize as a string"),
    }
}

pub(crate) fn decode_enum<T: DeserializeOwned>(value: &str) -> T {
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .expect("database enum value should be known")
}

pub(crate) fn owner_key(owner_wallet: &str) -> String {
    owner_wallet.to_lowercase()
}

pub(crate) fn i64_from_u64(value: u64, field: &str) -> i64 {
    i64::try_from(value).unwrap_or_else(|_| panic!("{field} does not fit in postgres bigint"))
}

pub(crate) fn i32_from_u32(value: u32, field: &str) -> i32 {
    i32::try_from(value).unwrap_or_else(|_| panic!("{field} does not fit in postgres integer"))
}

pub(crate) fn i32_from_u16(value: u16) -> i32 {
    i32::from(value)
}

fn u64_from_i64(value: i64, field: &str) -> u64 {
    u64::try_from(value).unwrap_or_else(|_| panic!("{field} is negative"))
}

fn u32_from_i32(value: i32, field: &str) -> u32 {
    u32::try_from(value).unwrap_or_else(|_| panic!("{field} is negative"))
}

fn u16_from_i32(value: i32, field: &str) -> u16 {
    u16::try_from(value).unwrap_or_else(|_| panic!("{field} is outside u16 range"))
}

fn billing_from_columns(
    plan: Option<String>,
    fee_bps: Option<i32>,
    gross_amount: Option<i64>,
    platform_fee: Option<i64>,
    merchant_net: Option<i64>,
) -> Option<CheckoutBillingSnapshot> {
    Some(CheckoutBillingSnapshot {
        plan: decode_enum(&plan?),
        fee_bps: u16_from_i32(fee_bps?, "billing.fee_bps"),
        gross_amount_minor_units: u64_from_i64(gross_amount?, "billing.gross_amount"),
        platform_fee_minor_units: u64_from_i64(platform_fee?, "billing.platform_fee"),
        merchant_net_minor_units: u64_from_i64(merchant_net?, "billing.merchant_net"),
    })
}

#[allow(dead_code)]
fn _type_check_enums(
    _plan: BillingPlan,
    _cycle: BillingCycle,
    _subscription_status: BillingSubscriptionStatus,
    _entitlement_status: BillingEntitlementStatus,
    _payment_status: BillingPaymentStatus,
    _project_environment: ProjectEnvironmentKind,
    _project_status: ProjectStatus,
    _authority_mode: InvoiceAuthorityMode,
    _checkout_status: CheckoutSessionStatus,
    _withdrawal_status: ProjectWithdrawalStatus,
    _payment_truth: PaymentTruth,
    _finality_status: FinalityStatus,
    _decrypt_status: DecryptJobStatus,
    _fulfillment_status: FulfillmentStatus,
    _webhook_status: WebhookDeliveryStatus,
) {
}
