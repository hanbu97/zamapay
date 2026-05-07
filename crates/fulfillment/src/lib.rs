use domain::{FinalityStatus, FulfillmentStatus, SettlementSnapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FulfillmentDecision {
    Hold,
    EnqueueRelease,
    FreezeForManualIntervention,
}

pub fn decide(snapshot: &SettlementSnapshot) -> FulfillmentDecision {
    if snapshot.finality_status == FinalityStatus::ReorgException {
        return FulfillmentDecision::FreezeForManualIntervention;
    }

    if snapshot.fulfillment_status == FulfillmentStatus::Released {
        return FulfillmentDecision::Hold;
    }

    if snapshot.is_fulfillment_ready() {
        return FulfillmentDecision::EnqueueRelease;
    }

    FulfillmentDecision::Hold
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{DecryptJobStatus, PaymentTruth};

    fn snapshot(
        payment_truth: PaymentTruth,
        finality_status: FinalityStatus,
        decrypt_job_status: DecryptJobStatus,
        fulfillment_status: FulfillmentStatus,
    ) -> SettlementSnapshot {
        SettlementSnapshot {
            invoice_id: 1,
            payment_truth,
            finality_status,
            decrypt_job_status,
            fulfillment_status,
        }
    }

    #[test]
    fn finality_gate_only_enqueues_after_finality_safe() {
        let pending = snapshot(
            PaymentTruth::Paid,
            FinalityStatus::AwaitingFinality,
            DecryptJobStatus::Completed,
            FulfillmentStatus::NotReady,
        );
        assert_eq!(decide(&pending), FulfillmentDecision::Hold);

        let ready = snapshot(
            PaymentTruth::Paid,
            FinalityStatus::FinalitySafe,
            DecryptJobStatus::Requested,
            FulfillmentStatus::Ready,
        );
        assert_eq!(decide(&ready), FulfillmentDecision::EnqueueRelease);
    }

    #[test]
    fn finality_gate_ignores_decrypt_success_without_finality_safe() {
        let decrypt_complete = snapshot(
            PaymentTruth::Paid,
            FinalityStatus::Indexing,
            DecryptJobStatus::Completed,
            FulfillmentStatus::NotReady,
        );
        assert_eq!(decide(&decrypt_complete), FulfillmentDecision::Hold);
    }

    #[test]
    fn finality_gate_freezes_on_reorg_exception() {
        let reorged = snapshot(
            PaymentTruth::Paid,
            FinalityStatus::ReorgException,
            DecryptJobStatus::Completed,
            FulfillmentStatus::FrozenForManualIntervention,
        );
        assert_eq!(
            decide(&reorged),
            FulfillmentDecision::FreezeForManualIntervention
        );
    }
}
