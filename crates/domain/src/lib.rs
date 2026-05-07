use chrono::{DateTime, SecondsFormat, Utc};
use thiserror::Error;

pub mod payment;

pub use payment::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, OperatorSettlementEvent, PaymentTruth,
    SettlementSnapshot, WebhookDeliveryOutcome, WebhookDeliverySnapshot, WebhookDeliveryStatus,
};

pub const LOGIN_MESSAGE_PREFIX: &str = "Mermer Pay merchant login";
pub const NONCE_TTL_SECONDS: i64 = 300;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DomainError {
    #[error("auth challenge has expired")]
    ExpiredChallenge,
}

pub fn build_login_message(address: &str, nonce: &str, issued_at: DateTime<Utc>) -> String {
    format!(
        "{LOGIN_MESSAGE_PREFIX}\naddress:{address}\nnonce:{nonce}\nissued_at:{}\npurpose:merchant-session",
        issued_at.to_rfc3339_opts(SecondsFormat::Secs, true)
    )
}

pub fn ensure_not_expired(issued_at: DateTime<Utc>, now: DateTime<Utc>) -> Result<(), DomainError> {
    let expires_at = issued_at + chrono::TimeDelta::seconds(NONCE_TTL_SECONDS);
    if now > expires_at {
        return Err(DomainError::ExpiredChallenge);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_stable_login_message() {
        let issued_at = DateTime::parse_from_rfc3339("2026-05-06T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let message = build_login_message("0xabc", "nonce-1", issued_at);

        assert!(message.contains(LOGIN_MESSAGE_PREFIX));
        assert!(message.contains("address:0xabc"));
        assert!(message.contains("nonce:nonce-1"));
    }
}
