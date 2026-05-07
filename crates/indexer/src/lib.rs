use std::error::Error;
use std::fmt::{Display, Formatter};

use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, OperatorSettlementEvent, PaymentTruth,
    SettlementSnapshot,
};
use shared::PaymentProjectionRequest;

pub const INVOICE_PAID_TOPIC: &str =
    "0xcf7efb09429cbc5408f78b7361fefa3fb1f0b1f3ffb95e9cbe8dfc933bdfe752";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainLog {
    pub transaction_hash: String,
    pub topics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentObservation {
    pub chain_invoice_id: u64,
    pub merchant_address: String,
    pub payer_address: String,
    pub payment_tx_hash: String,
}

impl PaymentObservation {
    pub fn projection_request(&self) -> PaymentProjectionRequest {
        PaymentProjectionRequest {
            chain_invoice_id: Some(self.chain_invoice_id),
            payment_tx_hash: self.payment_tx_hash.clone(),
            payer_address: self.payer_address.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogDecodeError {
    MissingTopic(&'static str),
    InvalidTopic(&'static str),
    InvoiceIdOverflow,
}

impl Display for LogDecodeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingTopic(field) => write!(formatter, "missing {field} topic"),
            Self::InvalidTopic(field) => write!(formatter, "invalid {field} topic"),
            Self::InvoiceIdOverflow => formatter.write_str("invoice id does not fit u64"),
        }
    }
}

impl Error for LogDecodeError {}

pub fn observe_invoice_paid(log: &ChainLog) -> Result<Option<PaymentObservation>, LogDecodeError> {
    let Some(event_topic) = log.topics.first() else {
        return Ok(None);
    };

    if !same_topic(event_topic, INVOICE_PAID_TOPIC) {
        return Ok(None);
    }

    Ok(Some(PaymentObservation {
        chain_invoice_id: parse_u64_topic(topic(log, 1, "invoiceId")?)?,
        merchant_address: parse_address_topic(topic(log, 2, "merchant")?)?,
        payer_address: parse_address_topic(topic(log, 3, "payer")?)?,
        payment_tx_hash: normalized_hash(&log.transaction_hash)?,
    }))
}

fn topic<'a>(
    log: &'a ChainLog,
    index: usize,
    field: &'static str,
) -> Result<&'a str, LogDecodeError> {
    log.topics
        .get(index)
        .map(String::as_str)
        .ok_or(LogDecodeError::MissingTopic(field))
}

fn same_topic(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn normalized_hash(raw: &str) -> Result<String, LogDecodeError> {
    Ok(format!(
        "0x{}",
        topic_hex(raw, "transactionHash")?.to_ascii_lowercase()
    ))
}

fn parse_address_topic(raw: &str) -> Result<String, LogDecodeError> {
    let hex = topic_hex(raw, "address")?;

    if hex[..24].chars().any(|character| character != '0') {
        return Err(LogDecodeError::InvalidTopic("address"));
    }

    Ok(format!("0x{}", hex[24..].to_ascii_lowercase()))
}

fn parse_u64_topic(raw: &str) -> Result<u64, LogDecodeError> {
    let hex = topic_hex(raw, "invoiceId")?;

    if hex[..48].chars().any(|character| character != '0') {
        return Err(LogDecodeError::InvoiceIdOverflow);
    }

    u64::from_str_radix(&hex[48..], 16).map_err(|_| LogDecodeError::InvalidTopic("invoiceId"))
}

fn topic_hex<'a>(raw: &'a str, field: &'static str) -> Result<&'a str, LogDecodeError> {
    let Some(hex) = raw.strip_prefix("0x") else {
        return Err(LogDecodeError::InvalidTopic(field));
    };

    if hex.len() != 64 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(LogDecodeError::InvalidTopic(field));
    }

    Ok(hex)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionState {
    snapshot: SettlementSnapshot,
    finality_threshold: u64,
    has_reached_finality_safe: bool,
}

impl ProjectionState {
    pub fn new(invoice_id: u64, finality_threshold: u64) -> Self {
        Self {
            snapshot: SettlementSnapshot {
                invoice_id,
                payment_truth: PaymentTruth::PendingPayment,
                finality_status: FinalityStatus::NotPaid,
                decrypt_job_status: DecryptJobStatus::Idle,
                fulfillment_status: FulfillmentStatus::NotReady,
            },
            finality_threshold,
            has_reached_finality_safe: false,
        }
    }

    pub fn from_snapshot(snapshot: SettlementSnapshot, finality_threshold: u64) -> Self {
        let has_reached_finality_safe = snapshot.finality_status == FinalityStatus::FinalitySafe;

        Self {
            snapshot,
            finality_threshold,
            has_reached_finality_safe,
        }
    }

    pub fn snapshot(&self) -> &SettlementSnapshot {
        &self.snapshot
    }

    pub fn apply_payment_detected(&mut self) {
        self.snapshot.payment_truth = PaymentTruth::Paid;
        self.snapshot.finality_status = FinalityStatus::Indexing;
        self.snapshot.fulfillment_status = FulfillmentStatus::NotReady;
    }

    pub fn apply_confirmations(&mut self, confirmations: u64) {
        if self.snapshot.payment_truth != PaymentTruth::Paid {
            return;
        }

        if confirmations >= self.finality_threshold {
            self.snapshot.finality_status = FinalityStatus::FinalitySafe;
            if self.snapshot.fulfillment_status != FulfillmentStatus::Released {
                self.snapshot.fulfillment_status = FulfillmentStatus::Ready;
            }
            self.has_reached_finality_safe = true;
            return;
        }

        if confirmations > 0 {
            self.snapshot.finality_status = FinalityStatus::AwaitingFinality;
        }
    }

    pub fn rollback_before_threshold(&mut self) {
        if self.has_reached_finality_safe {
            return;
        }

        self.snapshot.payment_truth = PaymentTruth::PendingPayment;
        self.snapshot.finality_status = FinalityStatus::NotPaid;
        self.snapshot.fulfillment_status = FulfillmentStatus::NotReady;
    }

    pub fn mark_deep_reorg_exception(&mut self) {
        self.snapshot.finality_status = FinalityStatus::ReorgException;
        self.snapshot.fulfillment_status = FulfillmentStatus::FrozenForManualIntervention;
    }

    pub fn mark_invoice_expired(&mut self) {
        if self.snapshot.payment_truth == PaymentTruth::Paid {
            return;
        }

        self.snapshot.payment_truth = PaymentTruth::Expired;
        self.snapshot.finality_status = FinalityStatus::NotPaid;
        self.snapshot.fulfillment_status = FulfillmentStatus::NotReady;
    }

    pub fn set_decrypt_job_status(&mut self, status: DecryptJobStatus) {
        self.snapshot.decrypt_job_status = status;
    }

    pub fn apply_operator_event(&mut self, event: OperatorSettlementEvent) {
        if let Some(status) = event.decrypt_status() {
            self.set_decrypt_job_status(status);
            return;
        }

        match event {
            OperatorSettlementEvent::RollbackBeforeThreshold => self.rollback_before_threshold(),
            OperatorSettlementEvent::DeepReorgException => self.mark_deep_reorg_exception(),
            OperatorSettlementEvent::InvoiceExpired => self.mark_invoice_expired(),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address_topic(address: &str) -> String {
        format!(
            "0x000000000000000000000000{}",
            address.trim_start_matches("0x")
        )
    }

    #[test]
    fn invoice_paid_log_becomes_operator_projection_request() {
        let log = ChainLog {
            transaction_hash: "0x83f17bd6c0c590aff470b3f32f5989dfe8bb524ece45ce6b4d507a91aae523b7"
                .to_string(),
            topics: vec![
                INVOICE_PAID_TOPIC.to_string(),
                "0x0000000000000000000000000000000000000000000000000000000000000008".to_string(),
                address_topic("0x1111111111111111111111111111111111111111"),
                address_topic("0x2222222222222222222222222222222222222222"),
            ],
        };

        let observation = observe_invoice_paid(&log).unwrap().unwrap();
        assert_eq!(observation.chain_invoice_id, 8);
        assert_eq!(
            observation.merchant_address,
            "0x1111111111111111111111111111111111111111"
        );
        assert_eq!(
            observation.payer_address,
            "0x2222222222222222222222222222222222222222"
        );

        let request = observation.projection_request();
        assert_eq!(request.chain_invoice_id, Some(8));
        assert_eq!(request.payment_tx_hash, log.transaction_hash);
        assert_eq!(
            request.payer_address,
            "0x2222222222222222222222222222222222222222"
        );
    }

    #[test]
    fn unrelated_log_is_ignored() {
        let log = ChainLog {
            transaction_hash: "0x83f17bd6c0c590aff470b3f32f5989dfe8bb524ece45ce6b4d507a91aae523b7"
                .to_string(),
            topics: vec![
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            ],
        };

        assert_eq!(observe_invoice_paid(&log).unwrap(), None);
    }

    #[test]
    fn malformed_invoice_paid_log_fails_closed() {
        let missing_payer = ChainLog {
            transaction_hash: "0x83f17bd6c0c590aff470b3f32f5989dfe8bb524ece45ce6b4d507a91aae523b7"
                .to_string(),
            topics: vec![
                INVOICE_PAID_TOPIC.to_string(),
                "0x0000000000000000000000000000000000000000000000000000000000000008".to_string(),
                address_topic("0x1111111111111111111111111111111111111111"),
            ],
        };

        assert_eq!(
            observe_invoice_paid(&missing_payer),
            Err(LogDecodeError::MissingTopic("payer"))
        );

        let overflowing_invoice = ChainLog {
            transaction_hash: "0x83f17bd6c0c590aff470b3f32f5989dfe8bb524ece45ce6b4d507a91aae523b7"
                .to_string(),
            topics: vec![
                INVOICE_PAID_TOPIC.to_string(),
                "0x0000000000000000000000000000000000000000000000010000000000000000".to_string(),
                address_topic("0x1111111111111111111111111111111111111111"),
                address_topic("0x2222222222222222222222222222222222222222"),
            ],
        };

        assert_eq!(
            observe_invoice_paid(&overflowing_invoice),
            Err(LogDecodeError::InvoiceIdOverflow)
        );
    }

    #[test]
    fn settlement_projection_promotes_paid_then_finality_safe() {
        let mut projection = ProjectionState::new(7, 12);

        projection.apply_payment_detected();
        assert_eq!(projection.snapshot().payment_truth, PaymentTruth::Paid);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::Indexing
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::NotReady
        );

        projection.apply_confirmations(3);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::AwaitingFinality
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::NotReady
        );

        projection.apply_confirmations(12);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::FinalitySafe
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::Ready
        );
    }

    #[test]
    fn settlement_projection_resumes_from_existing_paid_snapshot() {
        let snapshot = SettlementSnapshot {
            invoice_id: 13,
            payment_truth: PaymentTruth::Paid,
            finality_status: FinalityStatus::AwaitingFinality,
            decrypt_job_status: DecryptJobStatus::Idle,
            fulfillment_status: FulfillmentStatus::NotReady,
        };
        let mut projection = ProjectionState::from_snapshot(snapshot, 2);

        projection.apply_confirmations(1);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::AwaitingFinality
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::NotReady
        );

        projection.apply_confirmations(2);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::FinalitySafe
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::Ready
        );
    }

    #[test]
    fn settlement_projection_rolls_back_reorg_before_threshold() {
        let mut projection = ProjectionState::new(9, 6);

        projection.apply_payment_detected();
        projection.apply_confirmations(2);
        projection.rollback_before_threshold();

        assert_eq!(
            projection.snapshot().payment_truth,
            PaymentTruth::PendingPayment
        );
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::NotPaid
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::NotReady
        );
    }

    #[test]
    fn deep_reorg_exception_freezes_fulfillment_after_threshold() {
        let mut projection = ProjectionState::new(11, 3);

        projection.apply_payment_detected();
        projection.apply_confirmations(3);
        projection.mark_deep_reorg_exception();

        assert_eq!(projection.snapshot().payment_truth, PaymentTruth::Paid);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::ReorgException
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::FrozenForManualIntervention
        );
    }

    #[test]
    fn finality_confirmation_does_not_downgrade_released_fulfillment() {
        let snapshot = SettlementSnapshot {
            invoice_id: 13,
            payment_truth: PaymentTruth::Paid,
            finality_status: FinalityStatus::FinalitySafe,
            decrypt_job_status: DecryptJobStatus::Idle,
            fulfillment_status: FulfillmentStatus::Released,
        };
        let mut projection = ProjectionState::from_snapshot(snapshot, 2);

        projection.apply_confirmations(2);

        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::Released
        );
    }

    #[test]
    fn operator_event_updates_decrypt_and_reorg_state() {
        let mut projection = ProjectionState::new(12, 2);

        projection.apply_operator_event(OperatorSettlementEvent::DecryptPendingResult);
        assert_eq!(
            projection.snapshot().decrypt_job_status,
            DecryptJobStatus::PendingResult
        );

        projection.apply_payment_detected();
        projection.apply_confirmations(2);
        projection.apply_operator_event(OperatorSettlementEvent::DeepReorgException);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::ReorgException
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::FrozenForManualIntervention
        );
    }

    #[test]
    fn invoice_expiry_is_a_terminal_unpaid_projection() {
        let mut projection = ProjectionState::new(13, 2);

        projection.apply_operator_event(OperatorSettlementEvent::InvoiceExpired);

        assert_eq!(projection.snapshot().payment_truth, PaymentTruth::Expired);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::NotPaid
        );
        assert_eq!(
            projection.snapshot().fulfillment_status,
            FulfillmentStatus::NotReady
        );
    }

    #[test]
    fn invoice_expiry_does_not_rewrite_paid_truth() {
        let mut projection = ProjectionState::new(14, 2);
        projection.apply_payment_detected();
        projection.apply_confirmations(2);

        projection.apply_operator_event(OperatorSettlementEvent::InvoiceExpired);

        assert_eq!(projection.snapshot().payment_truth, PaymentTruth::Paid);
        assert_eq!(
            projection.snapshot().finality_status,
            FinalityStatus::FinalitySafe
        );
    }
}
