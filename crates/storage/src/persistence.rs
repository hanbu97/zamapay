use std::collections::HashMap;

use shared::{
    CheckoutSession, InvoiceRecord, PaymentProject, PaymentProjectEnvironment,
    ProjectInvoiceAuthority, ProjectWebhookEndpoint, WebhookDeliveryRecord, WebhookEventRecord,
};

use crate::project_support::StoredProjectApiKey;

#[derive(serde::Deserialize, serde::Serialize)]
pub(crate) struct PortalFile {
    #[serde(default)]
    pub(crate) invoices: HashMap<String, InvoiceRecord>,
    #[serde(default)]
    pub(crate) projects: HashMap<String, PaymentProject>,
    #[serde(default)]
    pub(crate) environments: HashMap<String, PaymentProjectEnvironment>,
    #[serde(default)]
    pub(crate) invoice_authorities: HashMap<String, ProjectInvoiceAuthority>,
    #[serde(default)]
    pub(crate) api_keys: HashMap<String, StoredProjectApiKey>,
    #[serde(default)]
    pub(crate) webhook_endpoints: HashMap<String, ProjectWebhookEndpoint>,
    #[serde(default)]
    pub(crate) checkout_sessions: HashMap<String, CheckoutSession>,
    #[serde(default)]
    pub(crate) idempotency_keys: HashMap<String, String>,
    #[serde(default)]
    pub(crate) webhook_events: HashMap<String, WebhookEventRecord>,
    #[serde(default)]
    pub(crate) webhook_deliveries: HashMap<String, WebhookDeliveryRecord>,
    #[serde(default = "default_next_invoice_number")]
    pub(crate) next_invoice_number: u64,
    #[serde(default = "default_next_chain_invoice_id")]
    pub(crate) next_chain_invoice_id: u64,
}

fn default_next_invoice_number() -> u64 {
    1
}

fn default_next_chain_invoice_id() -> u64 {
    1
}
