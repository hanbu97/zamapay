use std::hash::{Hash, Hasher};

use base64::{Engine as _, engine::general_purpose};
use chrono::{DateTime, Utc};
use domain::WebhookDeliveryStatus;
use ring::{aead, digest, rand};
use serde::{Deserialize, Serialize};
use shared::{
    CheckoutSession, CheckoutSessionStatus, PaymentProjectEnvironment, PaymentRail, ProjectApiKey,
    ProjectDashboardSummary, ProjectEnvironmentKind, ProjectPaymentRailSetting, ProjectStatus,
    ProjectWithdrawalRecord, WebhookDeliveryRecord,
};

pub(crate) const DEFAULT_DELIVERY_MAX_ATTEMPTS: u32 = 3;

const DEFAULT_LOCAL_SIGNER_ADDRESS: &str = "0x00000000000000000000000000000000000000f0";
const SECRET_ENCRYPTION_ENV: &str = "ZAMAPAY_SECRET_ENCRYPTION_KEY";
const LOCAL_SECRET_ENCRYPTION_FALLBACK: &str = "local-dev-zamapay-secret-encryption-key";
const SECRET_CIPHERTEXT_PREFIX: &str = "ring.aes256gcm.v1";

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
    RailDisabled,
    Unauthorized,
}

#[derive(Debug, Clone, Default)]
pub struct ProjectWithdrawalScope {
    pub chain_id: Option<u64>,
    pub token_contract: Option<String>,
    pub settlement_contract: Option<String>,
    pub recipient_address: Option<String>,
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

pub(crate) fn default_payment_rail_settings(
    project_id: &str,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
) -> Vec<ProjectPaymentRailSetting> {
    [PaymentRail::ZamaPrivate, PaymentRail::EvmErc20]
        .into_iter()
        .map(|payment_rail| ProjectPaymentRailSetting {
            project_id: project_id.to_string(),
            payment_rail,
            enabled: true,
            created_at,
            updated_at,
        })
        .collect()
}

pub(crate) fn payment_rail_setting_key(project_id: &str, payment_rail: PaymentRail) -> String {
    format!("{project_id}:{}", payment_rail.as_str())
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
    if let Some(value) = std::env::var("ZAMAPAY_PROJECT_MERCHANT_REGISTERED")
        .ok()
        .and_then(|value| parse_env_bool(&value))
    {
        return value;
    }

    shared::contract_manifest(environment.as_str())
        .ok()
        .flatten()
        .is_some_and(|manifest| {
            manifest
                .contracts
                .private_checkout_settlement
                .as_deref()
                .is_some_and(is_non_empty_address)
                && manifest
                    .contracts
                    .confidential_usd_mock
                    .as_deref()
                    .is_some_and(is_non_empty_address)
        })
}

fn parse_env_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn is_non_empty_address(value: &str) -> bool {
    !value.trim().is_empty()
}

pub(crate) fn hash_secret(secret: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    "zamapay-secret-v1".hash(&mut hasher);
    secret.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn webhook_secret(project_id: &str, endpoint_id: &str) -> String {
    let root = std::env::var("ZAMAPAY_DETERMINISTIC_WEBHOOK_SECRET_ROOT")
        .ok()
        .filter(|secret| !secret.trim().is_empty())
        .unwrap_or_else(|| "local-webhook-dev-secret".to_string());
    format!(
        "whsec_{}",
        hash_secret(&format!("{root}:{project_id}:{endpoint_id}"))
    )
}

pub(crate) fn secret_preview(secret: &str) -> String {
    shared::webhook_secret_preview(secret)
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

pub(crate) fn encrypt_webhook_secret(secret: &str) -> String {
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &secret_encryption_key())
        .expect("webhook secret encryption key must be valid");
    let key = aead::LessSafeKey::new(key);
    let rng = rand::SystemRandom::new();
    let mut nonce = [0_u8; 12];
    rand::SecureRandom::fill(&rng, &mut nonce).expect("system random should be available");
    let mut payload = secret.as_bytes().to_vec();
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(nonce),
        aead::Aad::from(SECRET_CIPHERTEXT_PREFIX.as_bytes()),
        &mut payload,
    )
    .expect("webhook secret encryption should succeed");
    format!(
        "{SECRET_CIPHERTEXT_PREFIX}:{}:{}",
        general_purpose::STANDARD_NO_PAD.encode(nonce),
        general_purpose::STANDARD_NO_PAD.encode(payload)
    )
}

pub(crate) fn decrypt_webhook_secret(ciphertext: &str) -> Option<String> {
    let mut parts = ciphertext.split(':');
    let prefix = parts.next()?;
    if prefix != SECRET_CIPHERTEXT_PREFIX {
        return None;
    }
    let nonce_text = parts.next()?;
    let payload_text = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let nonce_bytes = general_purpose::STANDARD_NO_PAD.decode(nonce_text).ok()?;
    let nonce: [u8; 12] = nonce_bytes.try_into().ok()?;
    let mut payload = general_purpose::STANDARD_NO_PAD.decode(payload_text).ok()?;
    let key = aead::UnboundKey::new(&aead::AES_256_GCM, &secret_encryption_key()).ok()?;
    let key = aead::LessSafeKey::new(key);
    let plaintext = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(SECRET_CIPHERTEXT_PREFIX.as_bytes()),
            &mut payload,
        )
        .ok()?;
    String::from_utf8(plaintext.to_vec()).ok()
}

fn secret_encryption_key() -> [u8; 32] {
    let configured = std::env::var(SECRET_ENCRYPTION_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            assert!(
                allows_local_secret_encryption_fallback(),
                "{SECRET_ENCRYPTION_ENV} is required outside local-dev/test"
            );
            LOCAL_SECRET_ENCRYPTION_FALLBACK.to_string()
        });
    if let Ok(decoded) = general_purpose::STANDARD_NO_PAD
        .decode(configured.trim())
        .or_else(|_| general_purpose::STANDARD.decode(configured.trim()))
    {
        if let Ok(key) = <[u8; 32]>::try_from(decoded) {
            return key;
        }
    }
    let digest = digest::digest(&digest::SHA256, configured.as_bytes());
    digest.as_ref().try_into().expect("sha256 is 32 bytes")
}

fn allows_local_secret_encryption_fallback() -> bool {
    cfg!(test)
        || std::env::var("ZAMAPAY_RUNTIME_PROFILE")
            .ok()
            .map(|profile| profile == "local-dev")
            .unwrap_or(false)
}
