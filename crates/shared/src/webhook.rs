use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub use webhook_verifier::{
    SVIX_ID_HEADER, SVIX_SIGNATURE_HEADER, SVIX_TIMESTAMP_HEADER, WEBHOOK_SECRET_PREFIX,
    WEBHOOK_SIGNATURE_VERSION, WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS, WebhookVerificationError,
    generate_webhook_secret, sign_webhook_payload, sign_webhook_payload_with_secrets,
    sign_webhook_payload_with_timestamp, signature_matches, try_sign_webhook_payload_with_secrets,
    try_sign_webhook_payload_with_timestamp, webhook_payload_sha256, webhook_secret_preview,
    webhook_signature_base,
};

pub const WEBHOOK_RETIRED_SECRET_TTL_HOURS: i64 = 24;
pub const WEBHOOK_RETIRED_SECRET_LIMIT: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookEndpointSecretStatus {
    Current,
    Retired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookEndpointSecretRecord {
    pub secret_id: String,
    pub endpoint_id: String,
    pub project_id: String,
    pub status: WebhookEndpointSecretStatus,
    #[serde(skip_serializing)]
    pub secret_ciphertext: String,
    pub secret_preview: String,
    #[serde(default)]
    pub migrated_from_deterministic: bool,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub revealed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub retired_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryAttemptRecord {
    pub attempt_id: String,
    pub delivery_id: String,
    pub event_id: String,
    pub endpoint_id: String,
    pub project_id: String,
    #[serde(skip_serializing)]
    pub request_headers: serde_json::Value,
    pub response_headers: Option<serde_json::Value>,
    pub http_status: Option<u16>,
    pub response_body: Option<String>,
    pub error: Option<String>,
    pub attempted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateWebhookEndpointSecretResponse {
    pub endpoint: crate::ProjectWebhookEndpoint,
    #[serde(default, skip_serializing)]
    pub webhook_secret: String,
}

pub fn verify_webhook_payload(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
    now: DateTime<Utc>,
) -> bool {
    verify_webhook_payload_result(
        secret,
        message_id,
        timestamp,
        signature_header,
        raw_body,
        now,
    )
    .is_ok()
}

pub fn verify_webhook_payload_result(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
    now: DateTime<Utc>,
) -> Result<(), WebhookVerificationError> {
    webhook_verifier::verify_webhook_payload_result(
        secret,
        message_id,
        timestamp,
        signature_header,
        raw_body,
        now.timestamp(),
    )
}

pub fn timestamp_is_fresh(timestamp: &str, now: DateTime<Utc>) -> bool {
    verify_webhook_timestamp(timestamp, now).is_ok()
}

pub fn verify_webhook_timestamp(
    timestamp: &str,
    now: DateTime<Utc>,
) -> Result<(), WebhookVerificationError> {
    webhook_verifier::verify_webhook_timestamp(timestamp, now.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn adapts_chrono_timestamps_to_the_protocol_verifier() {
        let now = Utc.timestamp_opt(1_700_001_000, 0).single().unwrap();

        assert!(timestamp_is_fresh("1700000750", now));
        assert!(!timestamp_is_fresh("1700000000", now));
        assert_eq!(
            verify_webhook_timestamp("1700000000", now),
            Err(WebhookVerificationError::TimestampTooOld)
        );
        assert_eq!(
            verify_webhook_timestamp("1700002000", now),
            Err(WebhookVerificationError::TimestampTooFarInFuture)
        );
    }
}
