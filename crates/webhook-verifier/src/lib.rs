use base64::{Engine as _, engine::general_purpose};
use ring::{digest, hmac, rand};

pub const SVIX_ID_HEADER: &str = "svix-id";
pub const SVIX_TIMESTAMP_HEADER: &str = "svix-timestamp";
pub const SVIX_SIGNATURE_HEADER: &str = "svix-signature";
pub const WEBHOOK_SECRET_PREFIX: &str = "whsec_";
pub const WEBHOOK_SIGNATURE_VERSION: &str = "v1";
pub const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: i64 = 5 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebhookVerificationError {
    InvalidSecret,
    InvalidTimestamp,
    TimestampTooOld,
    TimestampTooFarInFuture,
    InvalidSignature,
}

pub fn generate_webhook_secret() -> String {
    let rng = rand::SystemRandom::new();
    let mut key = [0_u8; 32];
    rand::SecureRandom::fill(&rng, &mut key).expect("system random should be available");
    format!(
        "{WEBHOOK_SECRET_PREFIX}{}",
        general_purpose::STANDARD_NO_PAD.encode(key)
    )
}

pub fn webhook_secret_preview(secret: &str) -> String {
    let len = secret.len();
    if len <= 18 {
        return secret.to_string();
    }
    format!("{}...{}", &secret[..10], &secret[len - 6..])
}

pub fn webhook_payload_sha256(raw_body: &str) -> String {
    lower_hex(digest::digest(&digest::SHA256, raw_body.as_bytes()).as_ref())
}

pub fn webhook_signature_base(message_id: &str, timestamp: &str, raw_body: &str) -> String {
    format!("{message_id}.{timestamp}.{raw_body}")
}

pub fn sign_webhook_payload(
    secret: &str,
    message_id: &str,
    timestamp: i64,
    raw_body: &str,
) -> String {
    let timestamp = timestamp.to_string();
    sign_webhook_payload_with_timestamp(secret, message_id, &timestamp, raw_body)
}

pub fn sign_webhook_payload_with_timestamp(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    raw_body: &str,
) -> String {
    try_sign_webhook_payload_with_timestamp(secret, message_id, timestamp, raw_body)
        .expect("webhook secret must be base64 encoded")
}

pub fn try_sign_webhook_payload_with_timestamp(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    raw_body: &str,
) -> Result<String, WebhookVerificationError> {
    let base = webhook_signature_base(message_id, timestamp, raw_body);
    let key = webhook_secret_key(secret).map_err(|_| WebhookVerificationError::InvalidSecret)?;
    Ok(sign_with_key(&key, base.as_bytes()))
}

pub fn sign_webhook_payload_with_secrets(
    secrets: &[String],
    message_id: &str,
    timestamp: i64,
    raw_body: &str,
) -> String {
    try_sign_webhook_payload_with_secrets(secrets, message_id, timestamp, raw_body)
        .expect("webhook secrets must be base64 encoded")
}

pub fn try_sign_webhook_payload_with_secrets(
    secrets: &[String],
    message_id: &str,
    timestamp: i64,
    raw_body: &str,
) -> Result<String, WebhookVerificationError> {
    let timestamp = timestamp.to_string();
    secrets
        .iter()
        .map(|secret| {
            try_sign_webhook_payload_with_timestamp(secret, message_id, &timestamp, raw_body)
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|signatures| signatures.join(" "))
}

pub fn verify_webhook_payload(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
    now_unix_seconds: i64,
) -> bool {
    verify_webhook_payload_result(
        secret,
        message_id,
        timestamp,
        signature_header,
        raw_body,
        now_unix_seconds,
    )
    .is_ok()
}

pub fn verify_webhook_payload_result(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
    now_unix_seconds: i64,
) -> Result<(), WebhookVerificationError> {
    verify_webhook_timestamp(timestamp, now_unix_seconds)?;
    signature_matches_result(secret, message_id, timestamp, signature_header, raw_body)?
        .then_some(())
        .ok_or(WebhookVerificationError::InvalidSignature)
}

pub fn signature_matches(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
) -> bool {
    signature_matches_result(secret, message_id, timestamp, signature_header, raw_body)
        .unwrap_or(false)
}

fn signature_matches_result(
    secret: &str,
    message_id: &str,
    timestamp: &str,
    signature_header: &str,
    raw_body: &str,
) -> Result<bool, WebhookVerificationError> {
    let base = webhook_signature_base(message_id, timestamp, raw_body);
    let key = webhook_secret_key(secret).map_err(|_| WebhookVerificationError::InvalidSecret)?;
    let expected = sign_with_key(&key, base.as_bytes());
    Ok(signature_header
        .split_whitespace()
        .any(|candidate| constant_time_eq(candidate.as_bytes(), expected.as_bytes())))
}

fn sign_with_key(key: &[u8], base: &[u8]) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, key);
    let signature = hmac::sign(&key, base);
    format!(
        "{WEBHOOK_SIGNATURE_VERSION},{}",
        general_purpose::STANDARD.encode(signature.as_ref())
    )
}

pub fn timestamp_is_fresh(timestamp: &str, now_unix_seconds: i64) -> bool {
    verify_webhook_timestamp(timestamp, now_unix_seconds).is_ok()
}

pub fn verify_webhook_timestamp(
    timestamp: &str,
    now_unix_seconds: i64,
) -> Result<(), WebhookVerificationError> {
    let Ok(sent_at) = timestamp.parse::<i64>() else {
        return Err(WebhookVerificationError::InvalidTimestamp);
    };
    if sent_at < 0 {
        return Err(WebhookVerificationError::InvalidTimestamp);
    }
    if sent_at.saturating_add(WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) < now_unix_seconds {
        return Err(WebhookVerificationError::TimestampTooOld);
    }
    if sent_at > now_unix_seconds.saturating_add(WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
        return Err(WebhookVerificationError::TimestampTooFarInFuture);
    }
    Ok(())
}

fn webhook_secret_key(secret: &str) -> Result<Vec<u8>, base64::DecodeError> {
    let body = secret
        .strip_prefix(WEBHOOK_SECRET_PREFIX)
        .unwrap_or(secret)
        .trim();
    general_purpose::STANDARD_NO_PAD
        .decode(body)
        .or_else(|_| general_purpose::STANDARD.decode(body))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0_u8;
    for (left, right) in left.iter().zip(right) {
        diff |= left ^ right;
    }
    diff == 0
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_the_raw_body_not_reserialized_json() {
        let secret = "whsec_Y3VycmVudC13ZWJob29rLXNlY3JldA";
        let compact = r#"{"event":"webhook.test","projectId":"proj_1"}"#;
        let spaced = r#"{"event": "webhook.test", "projectId": "proj_1"}"#;

        let compact_sig = sign_webhook_payload(secret, "msg_1", 1_700_000_000, compact);
        let spaced_sig = sign_webhook_payload(secret, "msg_1", 1_700_000_000, spaced);

        assert_ne!(compact_sig, spaced_sig);
        assert!(compact_sig.starts_with("v1,"));
    }

    #[test]
    fn accepts_space_separated_rotation_signatures() {
        let current = "whsec_Y3VycmVudC13ZWJob29rLXNlY3JldA";
        let retired = "whsec_cmV0aXJlZC13ZWJob29rLXNlY3JldA";
        let body = r#"{"event":"webhook.test"}"#;
        let header = sign_webhook_payload_with_secrets(
            &[current.to_string(), retired.to_string()],
            "msg_1",
            1_700_000_000,
            body,
        );

        assert!(signature_matches(
            retired,
            "msg_1",
            "1700000000",
            &header,
            body
        ));
    }

    #[test]
    fn rejects_invalid_base64_webhook_secret() {
        assert_eq!(
            try_sign_webhook_payload_with_timestamp(
                "whsec_not-base64",
                "msg_1",
                "1700000000",
                "{}"
            ),
            Err(WebhookVerificationError::InvalidSecret)
        );
        assert_eq!(
            verify_webhook_payload_result(
                "whsec_not-base64",
                "msg_1",
                "1700000000",
                "v1,deadbeef",
                "{}",
                1_700_000_000,
            ),
            Err(WebhookVerificationError::InvalidSecret)
        );
    }

    #[test]
    fn rejects_stale_timestamps() {
        let now = 1_700_001_000;

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
        assert_eq!(
            verify_webhook_timestamp("-1", now),
            Err(WebhookVerificationError::InvalidTimestamp)
        );
    }
}
