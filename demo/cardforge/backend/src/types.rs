use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const LOCAL_CHAIN_ID: u64 = 31337;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Product {
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: u64,
    pub(crate) codes: Vec<String>,
    pub(crate) id: String,
    pub(crate) title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FulfillmentSnapshot {
    pub(crate) cards: Vec<ReleasedCard>,
    pub(crate) latest_release: Option<ReleasedOrder>,
    pub(crate) released: bool,
    pub(crate) released_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleasedOrder {
    pub(crate) amount_label: Option<String>,
    pub(crate) cards: Vec<ReleasedCard>,
    pub(crate) checkout_session_id: String,
    pub(crate) invoice_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleasedCard {
    pub(crate) label: String,
    pub(crate) secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StorefrontResponse {
    pub(crate) merchant_label: String,
    pub(crate) zamapay_console_url: String,
    pub(crate) zamapay_login_url: String,
    pub(crate) product: Product,
    pub(crate) products: Vec<Product>,
    pub(crate) project_id: String,
    pub(crate) webhook_endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckoutResponse {
    pub(crate) billing: CheckoutBillingSnapshot,
    pub(crate) chain_invoice_id: u64,
    pub(crate) checkout_url: String,
    pub(crate) checkout_session_id: String,
    pub(crate) invoice_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCheckoutRequest {
    pub(crate) buyer_wallet_address: Option<String>,
    pub(crate) product_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckoutBillingSnapshot {
    pub(crate) fee_bps: u16,
    pub(crate) gross_amount_minor_units: u64,
    pub(crate) merchant_net_minor_units: u64,
    pub(crate) platform_fee_minor_units: u64,
    pub(crate) plan: String,
}

impl CheckoutBillingSnapshot {
    pub(crate) fn is_valid(&self) -> bool {
        self.gross_amount_minor_units > 0
            && self.merchant_net_minor_units > 0
            && self.platform_fee_minor_units > 0
            && self
                .merchant_net_minor_units
                .checked_add(self.platform_fee_minor_units)
                == Some(self.gross_amount_minor_units)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateCheckoutSessionRequest {
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: u64,
    pub(crate) cancel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) chain_invoice_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) chain_tx_hash: Option<String>,
    pub(crate) merchant_order_id: String,
    pub(crate) metadata: std::collections::BTreeMap<String, String>,
    pub(crate) note: String,
    pub(crate) success_url: Option<String>,
    pub(crate) title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckoutQuoteRequest {
    pub(crate) amount_minor_units: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckoutQuoteResponse {
    pub(crate) billing: CheckoutBillingSnapshot,
    pub(crate) merchant_owner_wallet: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ZamaPayCheckoutSessionResponse {
    pub(crate) billing: CheckoutBillingSnapshot,
    pub(crate) chain_invoice_id: u64,
    pub(crate) checkout_session_id: String,
    pub(crate) checkout_url: String,
    pub(crate) invoice_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalChainInvoiceResponse {
    pub(crate) chain_invoice_id: u64,
    pub(crate) chain_tx_hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebhookReceipt {
    pub(crate) id: Option<String>,
    pub(crate) signature: Option<String>,
    pub(crate) payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebhookAck {
    pub(crate) received: bool,
    pub(crate) received_event_count: usize,
    pub(crate) release_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebhookLog {
    pub(crate) events: Vec<WebhookReceipt>,
    pub(crate) received_event_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingOrder {
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: u64,
    pub(crate) buyer_wallet_address: Option<String>,
    pub(crate) chain_invoice_id: u64,
    pub(crate) checkout_session_id: String,
    pub(crate) created_at: String,
    pub(crate) invoice_id: String,
    pub(crate) product_id: String,
    pub(crate) product_title: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OwnedCard {
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: u64,
    pub(crate) cards: Vec<ReleasedCard>,
    pub(crate) chain_invoice_id: u64,
    pub(crate) checkout_session_id: String,
    pub(crate) id: String,
    pub(crate) invoice_id: String,
    pub(crate) payment_tx_hash: Option<String>,
    pub(crate) product_id: String,
    pub(crate) purchased_at: String,
    pub(crate) title: String,
    pub(crate) wallet_address: String,
}

impl OwnedCard {
    pub(crate) fn payment_record(&self) -> Option<WalletPaymentRecord> {
        Some(WalletPaymentRecord {
            amount_label: self.amount_label.clone(),
            amount_minor_units: self.amount_minor_units.to_string(),
            chain_id: LOCAL_CHAIN_ID,
            chain_invoice_id: Some(self.chain_invoice_id),
            checkout_session_id: Some(self.checkout_session_id.clone()),
            recorded_at: self.purchased_at.clone(),
            status: "confirmed",
            tx_hash: self.payment_tx_hash.as_ref()?.clone(),
            record_type: "payment",
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WalletActivityResponse {
    pub(crate) owned_cards: Vec<OwnedCard>,
    pub(crate) payments: Vec<WalletPaymentRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WalletPaymentRecord {
    pub(crate) amount_label: String,
    pub(crate) amount_minor_units: String,
    pub(crate) chain_id: u64,
    pub(crate) chain_invoice_id: Option<u64>,
    pub(crate) checkout_session_id: Option<String>,
    pub(crate) recorded_at: String,
    pub(crate) status: &'static str,
    pub(crate) tx_hash: String,
    #[serde(rename = "type")]
    pub(crate) record_type: &'static str,
}

pub(crate) fn epoch_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub(crate) fn is_transaction_hash(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}
