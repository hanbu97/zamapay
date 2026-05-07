use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentTruth {
    Draft,
    PendingPayment,
    Paid,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinalityStatus {
    NotPaid,
    Indexing,
    AwaitingFinality,
    FinalitySafe,
    ReorgException,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DecryptJobStatus {
    Idle,
    Requested,
    PendingResult,
    Completed,
    FailedTimeout,
    FailedReplayGuard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FulfillmentStatus {
    NotReady,
    Ready,
    Released,
    ReleaseFailed,
    FrozenForManualIntervention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperatorSettlementEvent {
    RollbackBeforeThreshold,
    DeepReorgException,
    InvoiceExpired,
    DecryptRequested,
    DecryptPendingResult,
    DecryptCompleted,
    DecryptTimeout,
    DecryptReplayGuard,
}

impl OperatorSettlementEvent {
    pub fn decrypt_status(self) -> Option<DecryptJobStatus> {
        match self {
            Self::DecryptRequested => Some(DecryptJobStatus::Requested),
            Self::DecryptPendingResult => Some(DecryptJobStatus::PendingResult),
            Self::DecryptCompleted => Some(DecryptJobStatus::Completed),
            Self::DecryptTimeout => Some(DecryptJobStatus::FailedTimeout),
            Self::DecryptReplayGuard => Some(DecryptJobStatus::FailedReplayGuard),
            Self::RollbackBeforeThreshold | Self::DeepReorgException | Self::InvoiceExpired => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookDeliveryOutcome {
    Delivered,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookDeliveryStatus {
    Idle,
    Pending,
    RetryScheduled,
    Delivered,
    DeadLetter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliverySnapshot {
    pub status: WebhookDeliveryStatus,
    pub attempt_count: u32,
    pub next_retry_after_seconds: Option<u32>,
}

impl Default for WebhookDeliverySnapshot {
    fn default() -> Self {
        Self {
            status: WebhookDeliveryStatus::Idle,
            attempt_count: 0,
            next_retry_after_seconds: None,
        }
    }
}

impl WebhookDeliverySnapshot {
    pub fn mark_pending_if_idle(&mut self) {
        if self.status != WebhookDeliveryStatus::Idle {
            return;
        }

        self.status = WebhookDeliveryStatus::Pending;
    }

    pub fn apply_delivery(&mut self, outcome: WebhookDeliveryOutcome, max_attempts: u32) {
        match outcome {
            WebhookDeliveryOutcome::Delivered => self.mark_delivered(),
            WebhookDeliveryOutcome::Failed => self.mark_failed(max_attempts),
        }
    }

    fn mark_delivered(&mut self) {
        self.status = WebhookDeliveryStatus::Delivered;
        self.next_retry_after_seconds = None;
    }

    fn mark_failed(&mut self, max_attempts: u32) {
        if matches!(
            self.status,
            WebhookDeliveryStatus::Delivered | WebhookDeliveryStatus::DeadLetter
        ) {
            return;
        }

        self.attempt_count += 1;
        if self.attempt_count >= max_attempts.max(1) {
            self.status = WebhookDeliveryStatus::DeadLetter;
            self.next_retry_after_seconds = None;
            return;
        }

        self.status = WebhookDeliveryStatus::RetryScheduled;
        self.next_retry_after_seconds = Some(retry_delay_seconds(self.attempt_count));
    }
}

fn retry_delay_seconds(attempt_count: u32) -> u32 {
    30 * attempt_count.min(10)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementSnapshot {
    pub invoice_id: u64,
    pub payment_truth: PaymentTruth,
    pub finality_status: FinalityStatus,
    pub decrypt_job_status: DecryptJobStatus,
    pub fulfillment_status: FulfillmentStatus,
}

impl SettlementSnapshot {
    pub fn is_fulfillment_ready(&self) -> bool {
        self.payment_truth == PaymentTruth::Paid
            && self.finality_status == FinalityStatus::FinalitySafe
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fulfillment_ready_requires_paid_and_finality_safe() {
        let ready = SettlementSnapshot {
            invoice_id: 1,
            payment_truth: PaymentTruth::Paid,
            finality_status: FinalityStatus::FinalitySafe,
            decrypt_job_status: DecryptJobStatus::Requested,
            fulfillment_status: FulfillmentStatus::Ready,
        };

        assert!(ready.is_fulfillment_ready());

        let awaiting = SettlementSnapshot {
            finality_status: FinalityStatus::AwaitingFinality,
            ..ready.clone()
        };
        assert!(!awaiting.is_fulfillment_ready());

        let failed = SettlementSnapshot {
            payment_truth: PaymentTruth::Failed,
            finality_status: FinalityStatus::FinalitySafe,
            ..ready
        };
        assert!(!failed.is_fulfillment_ready());
    }

    #[test]
    fn webhook_failure_schedules_retry_then_dead_letters() {
        let mut webhook = WebhookDeliverySnapshot::default();

        webhook.mark_pending_if_idle();
        webhook.apply_delivery(WebhookDeliveryOutcome::Failed, 2);

        assert_eq!(webhook.status, WebhookDeliveryStatus::RetryScheduled);
        assert_eq!(webhook.attempt_count, 1);
        assert_eq!(webhook.next_retry_after_seconds, Some(30));

        webhook.apply_delivery(WebhookDeliveryOutcome::Failed, 2);

        assert_eq!(webhook.status, WebhookDeliveryStatus::DeadLetter);
        assert_eq!(webhook.attempt_count, 2);
        assert_eq!(webhook.next_retry_after_seconds, None);

        webhook.apply_delivery(WebhookDeliveryOutcome::Failed, 2);

        assert_eq!(webhook.status, WebhookDeliveryStatus::DeadLetter);
        assert_eq!(webhook.attempt_count, 2);
    }

    #[test]
    fn webhook_success_is_idempotent_and_resolves_dead_letter() {
        let mut webhook = WebhookDeliverySnapshot::default();

        webhook.apply_delivery(WebhookDeliveryOutcome::Failed, 1);
        assert_eq!(webhook.status, WebhookDeliveryStatus::DeadLetter);

        webhook.apply_delivery(WebhookDeliveryOutcome::Delivered, 1);
        webhook.apply_delivery(WebhookDeliveryOutcome::Delivered, 1);

        assert_eq!(webhook.status, WebhookDeliveryStatus::Delivered);
        assert_eq!(webhook.attempt_count, 1);
        assert_eq!(webhook.next_retry_after_seconds, None);
    }
}
