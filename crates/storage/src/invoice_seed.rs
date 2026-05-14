use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, PaymentTruth, SettlementSnapshot,
};
use shared::{DEFAULT_FINALITY_THRESHOLD, InvoiceRecord, PaymentRail};

pub(crate) fn seeded_invoice(
    invoice_id: &str,
    title: &str,
    merchant_name: &str,
    amount_label: &str,
    amount_minor_units: u64,
    note: &str,
    payment_truth: PaymentTruth,
    finality_status: FinalityStatus,
    fulfillment_status: FulfillmentStatus,
) -> InvoiceRecord {
    InvoiceRecord {
        invoice_id: invoice_id.to_string(),
        project_id: None,
        checkout_session_id: None,
        environment: None,
        external_ref: None,
        title: title.to_string(),
        merchant_name: merchant_name.to_string(),
        amount_label: amount_label.to_string(),
        amount_minor_units,
        billing: None,
        note: note.to_string(),
        payment_rail: PaymentRail::ZamaPrivate,
        payment_intent_id: None,
        chain_invoice_id: None,
        chain_tx_hash: None,
        payment_tx_hash: None,
        payer_address: None,
        finality_confirmations: 0,
        finality_threshold: DEFAULT_FINALITY_THRESHOLD,
        webhook: Default::default(),
        fulfillment_release: None,
        decrypt_request: None,
        decrypt_pending_guard_trips: 0,
        snapshot: SettlementSnapshot {
            invoice_id: 0,
            payment_truth,
            finality_status,
            decrypt_job_status: DecryptJobStatus::Idle,
            fulfillment_status,
        },
    }
}
