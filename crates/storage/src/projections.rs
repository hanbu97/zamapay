use domain::{FinalityStatus, FulfillmentStatus, PaymentTruth, SettlementSnapshot};
use shared::{DEFAULT_FINALITY_THRESHOLD, IndexerCursor, InvoiceRecord};

#[derive(Debug, Clone, Copy)]
pub(crate) struct FinalityProgress {
    pub(crate) confirmations: u64,
    pub(crate) threshold: u64,
}

pub(crate) fn chain_sync_status(reorg_exceptions: u32, indexer_stalled: bool) -> String {
    if reorg_exceptions > 0 {
        return "intervention_required".to_string();
    }

    if indexer_stalled {
        return "stalled".to_string();
    }

    "healthy".to_string()
}

pub(crate) fn has_operator_action_required(counts: impl IntoIterator<Item = u32>) -> bool {
    counts.into_iter().any(|count| count > 0)
}

pub(crate) fn stalled_count(indexer_stalled: bool) -> u32 {
    u32::from(indexer_stalled)
}

pub(crate) fn has_indexer_stalled(invoices: &[InvoiceRecord]) -> bool {
    invoices.iter().any(|invoice| {
        invoice.chain_invoice_id.is_some()
            && invoice.payment_tx_hash.is_some()
            && invoice.snapshot.finality_status == FinalityStatus::AwaitingFinality
    })
}

pub(crate) fn indexer_cursor(invoices: &[InvoiceRecord]) -> IndexerCursor {
    let latest = invoices
        .iter()
        .filter(|invoice| invoice.chain_invoice_id.is_some())
        .max_by_key(|invoice| invoice.chain_invoice_id);

    IndexerCursor {
        latest_chain_invoice_id: latest.and_then(|invoice| invoice.chain_invoice_id),
        latest_payment_tx_hash: latest.and_then(|invoice| invoice.payment_tx_hash.clone()),
        indexed_invoices: invoices
            .iter()
            .filter(|invoice| invoice.chain_invoice_id.is_some())
            .count() as u32,
    }
}

pub(crate) fn project_paid(
    invoice: &mut InvoiceRecord,
    chain_invoice_id: Option<u64>,
    payment_tx_hash: &str,
    payer_address: &str,
) {
    let same_payment = invoice.payment_tx_hash.as_deref() == Some(payment_tx_hash);

    invoice.chain_invoice_id = chain_invoice_id.or(invoice.chain_invoice_id);
    invoice.payment_tx_hash = Some(payment_tx_hash.to_string());
    invoice.payer_address = Some(payer_address.to_string());
    invoice.snapshot.payment_truth = PaymentTruth::Paid;

    if same_payment {
        return;
    }

    invoice.finality_confirmations = 0;
    invoice.finality_threshold = DEFAULT_FINALITY_THRESHOLD;
    invoice.snapshot.finality_status = FinalityStatus::AwaitingFinality;
    invoice.snapshot.fulfillment_status = FulfillmentStatus::NotReady;
    invoice.webhook = Default::default();
    invoice.fulfillment_release = None;
}

pub(crate) fn apply_finality_progress(
    invoice: &mut InvoiceRecord,
    snapshot: &SettlementSnapshot,
    progress: Option<FinalityProgress>,
) {
    if let Some(progress) = progress {
        invoice.finality_confirmations = progress.confirmations;
        invoice.finality_threshold = progress.threshold;
        return;
    }

    if snapshot.finality_status == FinalityStatus::NotPaid {
        invoice.finality_confirmations = 0;
    }
}

pub(crate) fn mark_webhook_pending_if_due(invoice: &mut InvoiceRecord) {
    if invoice.snapshot.is_fulfillment_ready() {
        invoice.webhook.mark_pending_if_idle();
    }
}

pub(crate) fn preserve_release_status(invoice: &InvoiceRecord, snapshot: &mut SettlementSnapshot) {
    if invoice.fulfillment_release.is_some() && snapshot.is_fulfillment_ready() {
        snapshot.fulfillment_status = FulfillmentStatus::Released;
    }
}
