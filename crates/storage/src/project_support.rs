use std::hash::{Hash, Hasher};

use domain::WebhookDeliveryStatus;
use serde::{Deserialize, Serialize};
use shared::{
    CheckoutSession, CheckoutSessionStatus, PaymentProjectEnvironment, ProjectApiKey,
    ProjectDashboardSummary, ProjectEnvironmentKind, ProjectStatus, ProjectWithdrawalRecord,
    WebhookDeliveryRecord,
};

pub(crate) const DEFAULT_DELIVERY_MAX_ATTEMPTS: u32 = 3;

const DEFAULT_LOCAL_SIGNER_ADDRESS: &str = "0x00000000000000000000000000000000000000f0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredProjectApiKey {
    pub record: ProjectApiKey,
    pub secret_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckoutSessionError {
    InvalidRequest,
    Locked,
    NotFound,
    Unauthorized,
}

pub(crate) fn project_environment(
    project_id: &str,
    environment_id: &str,
    environment: ProjectEnvironmentKind,
    authority_id: &str,
) -> PaymentProjectEnvironment {
    let manifest = shared::contract_manifest(environment.as_str())
        .ok()
        .flatten();
    let chain_id = manifest.as_ref().and_then(|manifest| manifest.chain_id);
    let settlement_contract = manifest
        .as_ref()
        .and_then(|manifest| manifest.contracts.private_checkout_settlement.clone());
    let token_contract = manifest
        .as_ref()
        .and_then(|manifest| manifest.contracts.confidential_usd_mock.clone());

    PaymentProjectEnvironment {
        environment_id: environment_id.to_string(),
        project_id: project_id.to_string(),
        environment,
        chain_id,
        settlement_contract,
        token_contract,
        invoice_authority_id: authority_id.to_string(),
        status: ProjectStatus::Active,
    }
}

pub(crate) fn project_summary(
    sessions: &[CheckoutSession],
    deliveries: &[WebhookDeliveryRecord],
    withdrawals: &[ProjectWithdrawalRecord],
) -> ProjectDashboardSummary {
    let paid_sessions = sessions
        .iter()
        .filter(|session| session.status == CheckoutSessionStatus::Paid);
    let billing = paid_sessions.fold(BillingTotals::default(), |mut totals, session| {
        totals.gross += session.billing.gross_amount_minor_units;
        totals.platform_fee += session.billing.platform_fee_minor_units;
        totals.merchant_net += session.billing.merchant_net_minor_units;
        totals
    });
    let withdrawn = withdrawals
        .iter()
        .map(|withdrawal| withdrawal.amount_minor_units)
        .sum::<u64>();

    ProjectDashboardSummary {
        total_checkouts: sessions.len() as u32,
        open_checkouts: sessions
            .iter()
            .filter(|session| session.status == CheckoutSessionStatus::Open)
            .count() as u32,
        paid_checkouts: sessions
            .iter()
            .filter(|session| session.status == CheckoutSessionStatus::Paid)
            .count() as u32,
        gross_volume_minor_units: billing.gross,
        platform_fee_minor_units: billing.platform_fee,
        merchant_net_minor_units: billing.merchant_net,
        withdrawn_minor_units: withdrawn,
        withdrawable_minor_units: billing.merchant_net.saturating_sub(withdrawn),
        pending_deliveries: deliveries
            .iter()
            .filter(|delivery| {
                matches!(
                    delivery.status,
                    WebhookDeliveryStatus::Pending | WebhookDeliveryStatus::RetryScheduled
                )
            })
            .count() as u32,
        delivered_webhooks: deliveries
            .iter()
            .filter(|delivery| delivery.status == WebhookDeliveryStatus::Delivered)
            .count() as u32,
        failed_webhooks: deliveries
            .iter()
            .filter(|delivery| delivery.status == WebhookDeliveryStatus::DeadLetter)
            .count() as u32,
    }
}

#[derive(Default)]
struct BillingTotals {
    gross: u64,
    platform_fee: u64,
    merchant_net: u64,
}

pub(crate) fn signer_address(environment: &ProjectEnvironmentKind) -> String {
    let _ = environment;
    std::env::var("ZAMAPAY_PROJECT_SIGNER_ADDRESS")
        .ok()
        .filter(|address| !address.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_LOCAL_SIGNER_ADDRESS.to_string())
}

pub(crate) fn signer_key_ref(environment: &ProjectEnvironmentKind) -> String {
    format!("{}-project-signer", environment.as_str())
}

pub(crate) fn merchant_registered(environment: &ProjectEnvironmentKind) -> bool {
    let _ = environment;
    true
}

pub(crate) fn hash_secret(secret: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    "zamapay-secret-v1".hash(&mut hasher);
    secret.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn webhook_secret(project_id: &str, endpoint_id: &str) -> String {
    let root = std::env::var("ZAMAPAY_WEBHOOK_SECRET")
        .ok()
        .filter(|secret| !secret.trim().is_empty())
        .unwrap_or_else(|| "local-webhook-dev-secret".to_string());
    format!(
        "whsec_{}",
        hash_secret(&format!("{root}:{project_id}:{endpoint_id}"))
    )
}

pub(crate) fn secret_preview(secret: &str) -> String {
    format!("{}...{}", &secret[..10], &secret[secret.len() - 6..])
}

pub(crate) fn clean_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(crate) fn parse_environment(value: &str) -> ProjectEnvironmentKind {
    match shared::normalize_contract_environment(value) {
        Some("sepolia") => ProjectEnvironmentKind::Sepolia,
        _ => ProjectEnvironmentKind::LocalDev,
    }
}
