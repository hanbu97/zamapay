use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, OperatorSettlementEvent, PaymentTruth,
    SettlementSnapshot,
};

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
