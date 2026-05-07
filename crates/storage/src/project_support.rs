use std::hash::{Hash, Hasher};

use domain::WebhookDeliveryStatus;
use serde::{Deserialize, Serialize};
use shared::{
    CheckoutSession, CheckoutSessionStatus, PaymentProjectEnvironment, ProjectApiKey,
    ProjectDashboardSummary, ProjectEnvironmentKind, ProjectStatus, WebhookDeliveryRecord,
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
        .and_then(|manifest| manifest.contracts.confidential_invoice_settlement.clone());
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
) -> ProjectDashboardSummary {
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

pub(crate) fn signer_address(environment: &ProjectEnvironmentKind) -> String {
    std::env::var("MERMER_PAY_PROJECT_SIGNER_ADDRESS")
        .ok()
        .filter(|address| !address.trim().is_empty())
        .unwrap_or_else(|| match environment {
            ProjectEnvironmentKind::LocalDev => DEFAULT_LOCAL_SIGNER_ADDRESS.to_string(),
            ProjectEnvironmentKind::Sepolia => String::new(),
        })
}

pub(crate) fn signer_key_ref(environment: &ProjectEnvironmentKind) -> String {
    match environment {
        ProjectEnvironmentKind::LocalDev => "local-dev-project-signer".to_string(),
        ProjectEnvironmentKind::Sepolia => std::env::var("MERMER_PAY_PROJECT_SIGNER_KEY_REF")
            .unwrap_or_else(|_| "env:MERMER_PAY_PROJECT_SIGNER_PRIVATE_KEY".to_string()),
    }
}

pub(crate) fn merchant_registered(environment: &ProjectEnvironmentKind) -> bool {
    match environment {
        ProjectEnvironmentKind::LocalDev => true,
        ProjectEnvironmentKind::Sepolia => std::env::var("MERMER_PAY_PROJECT_SIGNER_PRIVATE_KEY")
            .ok()
            .filter(|key| !key.trim().is_empty())
            .is_some(),
    }
}

pub(crate) fn hash_secret(secret: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    "mermer-secret-v1".hash(&mut hasher);
    secret.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn webhook_secret(project_id: &str, endpoint_id: &str) -> String {
    let root = std::env::var("MERMER_WEBHOOK_SECRET")
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

pub(crate) fn local_chain_tx_hash(chain_invoice_id: u64) -> String {
    format!("0x{:064x}", chain_invoice_id)
}

pub(crate) fn clean_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

pub(crate) fn parse_environment(value: &str) -> ProjectEnvironmentKind {
    if value == "sepolia" {
        ProjectEnvironmentKind::Sepolia
    } else {
        ProjectEnvironmentKind::LocalDev
    }
}
