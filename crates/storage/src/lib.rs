use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, NONCE_TTL_SECONDS, PaymentTruth,
    SettlementSnapshot, WebhookDeliveryOutcome, WebhookDeliveryStatus, build_login_message,
};
use shared::{
    CheckoutSession, DEFAULT_FINALITY_THRESHOLD, DashboardOverview, DashboardSummary,
    DecryptCallbackOutcome, DecryptRequestSnapshot, FulfillmentReleaseAudit, IndexerCursor,
    InvoiceRecord, OperatorDiagnostics, PaymentProject, PaymentProjectEnvironment,
    ProjectInvoiceAuthority, ProjectWebhookEndpoint, SessionUser, WebhookDeliveryRecord,
    WebhookEventRecord,
};
use uuid::Uuid;

mod invoice_seed;
mod persistence;
mod project_support;
mod projects;
pub use project_support::CheckoutSessionError;

use invoice_seed::seeded_invoice;
use persistence::PortalFile;

const PORTAL_STORE_PATH_ENV: &str = "MERMER_PORTAL_STORE_PATH";

#[derive(Debug, Clone)]
pub struct StoredChallenge {
    pub address: String,
    pub nonce: String,
    pub message: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub consumed: bool,
}

#[derive(Debug, Clone)]
pub struct StoredSession {
    pub user: SessionUser,
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryAuthStore {
    challenges: Arc<RwLock<HashMap<String, StoredChallenge>>>,
    sessions: Arc<RwLock<HashMap<Uuid, StoredSession>>>,
}

impl InMemoryAuthStore {
    pub fn issue_challenge(&self, address: &str, now: DateTime<Utc>) -> StoredChallenge {
        let nonce = Uuid::new_v4().to_string();
        let challenge = StoredChallenge {
            address: address.to_lowercase(),
            nonce: nonce.clone(),
            message: build_login_message(address, &nonce, now),
            issued_at: now,
            expires_at: now + chrono::TimeDelta::seconds(NONCE_TTL_SECONDS),
            consumed: false,
        };

        self.challenges
            .write()
            .expect("challenge store lock poisoned")
            .insert(address.to_lowercase(), challenge.clone());

        challenge
    }

    pub fn find_challenge(&self, address: &str) -> Option<StoredChallenge> {
        self.challenges
            .read()
            .expect("challenge store lock poisoned")
            .get(&address.to_lowercase())
            .cloned()
    }

    pub fn consume_challenge(&self, address: &str) {
        if let Some(existing) = self
            .challenges
            .write()
            .expect("challenge store lock poisoned")
            .get_mut(&address.to_lowercase())
        {
            existing.consumed = true;
        }
    }

    pub fn create_session(&self, address: &str, now: DateTime<Utc>) -> StoredSession {
        let session = StoredSession {
            user: SessionUser {
                address: address.to_string(),
                session_id: Uuid::new_v4(),
                issued_at: now,
            },
        };

        self.sessions
            .write()
            .expect("session store lock poisoned")
            .insert(session.user.session_id, session.clone());

        session
    }

    pub fn find_session(&self, session_id: &Uuid) -> Option<StoredSession> {
        self.sessions
            .read()
            .expect("session store lock poisoned")
            .get(session_id)
            .cloned()
    }
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryPortalStore {
    invoices: Arc<RwLock<HashMap<String, InvoiceRecord>>>,
    projects: Arc<RwLock<HashMap<String, PaymentProject>>>,
    environments: Arc<RwLock<HashMap<String, PaymentProjectEnvironment>>>,
    invoice_authorities: Arc<RwLock<HashMap<String, ProjectInvoiceAuthority>>>,
    api_keys: Arc<RwLock<HashMap<String, project_support::StoredProjectApiKey>>>,
    webhook_endpoints: Arc<RwLock<HashMap<String, ProjectWebhookEndpoint>>>,
    checkout_sessions: Arc<RwLock<HashMap<String, CheckoutSession>>>,
    idempotency_keys: Arc<RwLock<HashMap<String, String>>>,
    webhook_events: Arc<RwLock<HashMap<String, WebhookEventRecord>>>,
    webhook_deliveries: Arc<RwLock<HashMap<String, WebhookDeliveryRecord>>>,
    next_invoice_number: Arc<RwLock<u64>>,
    next_chain_invoice_id: Arc<RwLock<u64>>,
    persistence_path: Option<Arc<PathBuf>>,
}

#[derive(Debug, Clone)]
pub enum DecryptRequestProjection {
    Created(InvoiceRecord),
    AlreadyPending(InvoiceRecord),
    NotPaid(InvoiceRecord),
}

impl InMemoryPortalStore {
    pub fn from_env() -> Self {
        match std::env::var(PORTAL_STORE_PATH_ENV) {
            Ok(path) if !path.trim().is_empty() => Self::persisted(path),
            _ => Self::seeded(),
        }
    }

    pub fn persisted(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        match read_portal_file(&path) {
            Some(data) => Self {
                invoices: Arc::new(RwLock::new(data.invoices)),
                projects: Arc::new(RwLock::new(data.projects)),
                environments: Arc::new(RwLock::new(data.environments)),
                invoice_authorities: Arc::new(RwLock::new(data.invoice_authorities)),
                api_keys: Arc::new(RwLock::new(data.api_keys)),
                webhook_endpoints: Arc::new(RwLock::new(data.webhook_endpoints)),
                checkout_sessions: Arc::new(RwLock::new(data.checkout_sessions)),
                idempotency_keys: Arc::new(RwLock::new(data.idempotency_keys)),
                webhook_events: Arc::new(RwLock::new(data.webhook_events)),
                webhook_deliveries: Arc::new(RwLock::new(data.webhook_deliveries)),
                next_invoice_number: Arc::new(RwLock::new(data.next_invoice_number)),
                next_chain_invoice_id: Arc::new(RwLock::new(data.next_chain_invoice_id)),
                persistence_path: Some(Arc::new(path)),
            },
            None => {
                let store = Self::seeded().with_persistence_path(path);
                store.persist();
                store
            }
        }
    }

    pub fn seeded() -> Self {
        Self {
            invoices: Arc::new(RwLock::new(HashMap::new())),
            projects: Arc::new(RwLock::new(HashMap::new())),
            environments: Arc::new(RwLock::new(HashMap::new())),
            invoice_authorities: Arc::new(RwLock::new(HashMap::new())),
            api_keys: Arc::new(RwLock::new(HashMap::new())),
            webhook_endpoints: Arc::new(RwLock::new(HashMap::new())),
            checkout_sessions: Arc::new(RwLock::new(HashMap::new())),
            idempotency_keys: Arc::new(RwLock::new(HashMap::new())),
            webhook_events: Arc::new(RwLock::new(HashMap::new())),
            webhook_deliveries: Arc::new(RwLock::new(HashMap::new())),
            next_invoice_number: Arc::new(RwLock::new(1)),
            next_chain_invoice_id: Arc::new(RwLock::new(1)),
            persistence_path: None,
        }
    }

    fn with_persistence_path(mut self, path: PathBuf) -> Self {
        self.persistence_path = Some(Arc::new(path));
        self
    }

    pub fn dashboard_overview(&self, merchant_address: &str) -> DashboardOverview {
        let invoices = self.invoices.read().expect("portal store lock poisoned");
        let invoice_list = invoices.values().cloned().collect::<Vec<_>>();

        DashboardOverview {
            merchant_name: "Mermer merchant".to_string(),
            merchant_address: merchant_address.to_string(),
            summary: DashboardSummary {
                total_invoices: invoice_list.len() as u32,
                paid_invoices: invoice_list
                    .iter()
                    .filter(|invoice| invoice.snapshot.payment_truth == PaymentTruth::Paid)
                    .count() as u32,
                pending_invoices: invoice_list
                    .iter()
                    .filter(|invoice| {
                        invoice.snapshot.payment_truth == PaymentTruth::PendingPayment
                    })
                    .count() as u32,
                finality_backlog: invoice_list
                    .iter()
                    .filter(|invoice| {
                        invoice.snapshot.finality_status == FinalityStatus::AwaitingFinality
                    })
                    .count() as u32,
            },
            invoices: invoice_list,
        }
    }

    pub fn invoice_by_id(&self, invoice_id: &str) -> Option<InvoiceRecord> {
        self.invoices
            .read()
            .expect("portal store lock poisoned")
            .get(invoice_id)
            .cloned()
    }

    pub fn invoice_by_chain_invoice_id(&self, chain_invoice_id: u64) -> Option<InvoiceRecord> {
        self.invoices
            .read()
            .expect("portal store lock poisoned")
            .values()
            .find(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))
            .cloned()
    }

    pub fn create_invoice(
        &self,
        title: &str,
        amount_label: &str,
        amount_minor_units: u64,
        note: &str,
        external_ref: Option<&str>,
        chain_invoice_id: Option<u64>,
        chain_tx_hash: Option<&str>,
    ) -> InvoiceRecord {
        let invoice_id = external_ref
            .filter(|reference| !reference.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let mut next_invoice_number = self
                    .next_invoice_number
                    .write()
                    .expect("portal invoice counter lock poisoned");
                let next_invoice_id = format!("invoice-{:04}", *next_invoice_number);
                *next_invoice_number += 1;
                next_invoice_id
            });

        let mut invoice = seeded_invoice(
            &invoice_id,
            title,
            "Mermer merchant",
            amount_label,
            amount_minor_units,
            note,
            PaymentTruth::PendingPayment,
            FinalityStatus::NotPaid,
            FulfillmentStatus::NotReady,
        );
        invoice.chain_invoice_id = chain_invoice_id;
        invoice.chain_tx_hash = chain_tx_hash.map(str::to_string);

        self.invoices
            .write()
            .expect("portal store lock poisoned")
            .insert(invoice_id, invoice.clone());
        self.persist();

        invoice
    }

    pub fn project_invoice_paid(
        &self,
        invoice_id: &str,
        chain_invoice_id: Option<u64>,
        payment_tx_hash: &str,
        payer_address: &str,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices.get_mut(invoice_id)?;

        project_paid(invoice, chain_invoice_id, payment_tx_hash, payer_address);
        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(invoice)
    }

    pub fn project_chain_invoice_paid(
        &self,
        chain_invoice_id: u64,
        payment_tx_hash: &str,
        payer_address: &str,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices
            .values_mut()
            .find(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))?;

        project_paid(
            invoice,
            Some(chain_invoice_id),
            payment_tx_hash,
            payer_address,
        );
        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(invoice)
    }

    pub fn project_chain_invoice_snapshot(
        &self,
        chain_invoice_id: u64,
        snapshot: SettlementSnapshot,
    ) -> Option<InvoiceRecord> {
        self.project_chain_invoice_snapshot_with_progress(chain_invoice_id, snapshot, None)
    }

    pub fn project_chain_invoice_finality_snapshot(
        &self,
        chain_invoice_id: u64,
        snapshot: SettlementSnapshot,
        confirmations: u64,
        finality_threshold: u64,
    ) -> Option<InvoiceRecord> {
        self.project_chain_invoice_snapshot_with_progress(
            chain_invoice_id,
            snapshot,
            Some(FinalityProgress {
                confirmations,
                threshold: finality_threshold,
            }),
        )
    }

    fn project_chain_invoice_snapshot_with_progress(
        &self,
        chain_invoice_id: u64,
        mut snapshot: SettlementSnapshot,
        progress: Option<FinalityProgress>,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices
            .values_mut()
            .find(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))?;

        preserve_release_status(invoice, &mut snapshot);
        apply_finality_progress(invoice, &snapshot, progress);
        invoice.snapshot = snapshot;
        mark_webhook_pending_if_due(invoice);
        let invoice = invoice.clone();
        drop(invoices);
        self.enqueue_webhook_event_if_ready(&invoice);
        self.persist();

        Some(invoice)
    }

    pub fn project_chain_invoice_webhook_delivery(
        &self,
        chain_invoice_id: u64,
        outcome: WebhookDeliveryOutcome,
        max_attempts: u32,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices
            .values_mut()
            .find(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))?;

        invoice.webhook.apply_delivery(outcome, max_attempts);
        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(invoice)
    }

    pub fn request_invoice_decrypt(
        &self,
        invoice_id: &str,
        requested_at: DateTime<Utc>,
    ) -> Option<DecryptRequestProjection> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices.get_mut(invoice_id)?;

        if invoice.snapshot.payment_truth != PaymentTruth::Paid {
            return Some(DecryptRequestProjection::NotPaid(invoice.clone()));
        }

        if matches!(
            invoice.snapshot.decrypt_job_status,
            DecryptJobStatus::Requested | DecryptJobStatus::PendingResult
        ) {
            invoice.decrypt_pending_guard_trips += 1;
            let invoice = invoice.clone();
            drop(invoices);
            self.persist();
            return Some(DecryptRequestProjection::AlreadyPending(invoice));
        }

        invoice.snapshot.decrypt_job_status = DecryptJobStatus::Requested;
        invoice.decrypt_request = Some(DecryptRequestSnapshot {
            request_id: format!("dec_{}", Uuid::new_v4().simple()),
            requested_at,
            completed_at: None,
            callback_sender: None,
            replayed_callback_count: 0,
        });
        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(DecryptRequestProjection::Created(invoice))
    }

    pub fn project_decrypt_callback(
        &self,
        request_id: &str,
        outcome: DecryptCallbackOutcome,
        callback_sender: &str,
        completed_at: DateTime<Utc>,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices.values_mut().find(|invoice| {
            invoice
                .decrypt_request
                .as_ref()
                .is_some_and(|request| request.request_id == request_id)
        })?;
        let request = invoice.decrypt_request.as_mut()?;

        if request.completed_at.is_some() {
            request.replayed_callback_count += 1;
            let invoice = invoice.clone();
            drop(invoices);
            self.persist();
            return Some(invoice);
        }

        request.completed_at = Some(completed_at);
        request.callback_sender = Some(callback_sender.to_string());
        invoice.snapshot.decrypt_job_status = match outcome {
            DecryptCallbackOutcome::Completed => DecryptJobStatus::Completed,
            DecryptCallbackOutcome::FailedTimeout => DecryptJobStatus::FailedTimeout,
        };

        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(invoice)
    }

    pub fn release_fulfillment(
        &self,
        invoice_id: &str,
        released_at: DateTime<Utc>,
        artifact_count: u32,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().expect("portal store lock poisoned");
        let invoice = invoices.get_mut(invoice_id)?;

        if invoice.fulfillment_release.is_none() && invoice.snapshot.is_fulfillment_ready() {
            invoice.snapshot.fulfillment_status = FulfillmentStatus::Released;
            invoice.fulfillment_release = Some(FulfillmentReleaseAudit {
                invoice_id: invoice.invoice_id.clone(),
                job_id: format!("ful_{}", Uuid::new_v4().simple()),
                released_at,
                artifact_count,
            });
        }

        let invoice = invoice.clone();
        drop(invoices);
        self.persist();

        Some(invoice)
    }

    pub fn operator_diagnostics(&self, operator_auth_rejections: u32) -> OperatorDiagnostics {
        let invoices = self
            .invoices
            .read()
            .expect("portal store lock poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let decrypt_timeouts = invoices
            .iter()
            .filter(|invoice| {
                invoice.snapshot.decrypt_job_status == DecryptJobStatus::FailedTimeout
            })
            .count() as u32;
        let replay_guard_failures = invoices
            .iter()
            .filter(|invoice| {
                invoice.snapshot.decrypt_job_status == DecryptJobStatus::FailedReplayGuard
            })
            .count() as u32;
        let reorg_exceptions = invoices
            .iter()
            .filter(|invoice| invoice.snapshot.finality_status == FinalityStatus::ReorgException)
            .count() as u32;
        let frozen_fulfillments = invoices
            .iter()
            .filter(|invoice| {
                invoice.snapshot.fulfillment_status
                    == FulfillmentStatus::FrozenForManualIntervention
            })
            .count() as u32;
        let release_failures = invoices
            .iter()
            .filter(|invoice| {
                invoice.snapshot.fulfillment_status == FulfillmentStatus::ReleaseFailed
            })
            .count() as u32;
        let pending_webhooks = invoices
            .iter()
            .filter(|invoice| invoice.webhook.status == WebhookDeliveryStatus::Pending)
            .count() as u32;
        let retrying_webhooks = invoices
            .iter()
            .filter(|invoice| invoice.webhook.status == WebhookDeliveryStatus::RetryScheduled)
            .count() as u32;
        let failed_webhooks = invoices
            .iter()
            .filter(|invoice| invoice.webhook.status == WebhookDeliveryStatus::DeadLetter)
            .count() as u32;
        let expired_invoices = invoices
            .iter()
            .filter(|invoice| invoice.snapshot.payment_truth == PaymentTruth::Expired)
            .count() as u32;
        let decrypt_pending_guard_trips = invoices
            .iter()
            .map(|invoice| invoice.decrypt_pending_guard_trips)
            .sum();
        let indexer_cursor = indexer_cursor(&invoices);
        let indexer_stalled = has_indexer_stalled(&invoices);

        OperatorDiagnostics {
            chain_sync_status: chain_sync_status(reorg_exceptions, indexer_stalled),
            indexer_cursor,
            indexer_stalled,
            pending_decrypt_jobs: invoices
                .iter()
                .filter(|invoice| {
                    matches!(
                        invoice.snapshot.decrypt_job_status,
                        DecryptJobStatus::Requested | DecryptJobStatus::PendingResult
                    )
                })
                .count() as u32,
            pending_finality_backlog: invoices
                .iter()
                .filter(|invoice| {
                    invoice.snapshot.finality_status == FinalityStatus::AwaitingFinality
                })
                .count() as u32,
            pending_webhooks,
            retrying_webhooks,
            failed_webhooks,
            expired_invoices,
            operator_auth_rejections,
            decrypt_pending_guard_trips,
            decrypt_timeouts,
            replay_guard_failures,
            reorg_exceptions,
            frozen_fulfillments,
            release_failures,
            operator_action_required: has_operator_action_required([
                failed_webhooks,
                stalled_count(indexer_stalled),
                expired_invoices,
                operator_auth_rejections,
                decrypt_timeouts,
                replay_guard_failures,
                reorg_exceptions,
                frozen_fulfillments,
                release_failures,
            ]),
            invoices,
        }
    }

    fn persist(&self) {
        let Some(path) = self.persistence_path.as_deref() else {
            return;
        };

        let invoices = self
            .invoices
            .read()
            .expect("portal store lock poisoned")
            .clone();
        let next_invoice_number = *self
            .next_invoice_number
            .read()
            .expect("portal invoice counter lock poisoned");
        let next_chain_invoice_id = *self
            .next_chain_invoice_id
            .read()
            .expect("portal chain invoice counter lock poisoned");
        let data = PortalFile {
            invoices,
            projects: self
                .projects
                .read()
                .expect("project store lock poisoned")
                .clone(),
            environments: self
                .environments
                .read()
                .expect("project environment store lock poisoned")
                .clone(),
            invoice_authorities: self
                .invoice_authorities
                .read()
                .expect("invoice authority store lock poisoned")
                .clone(),
            api_keys: self
                .api_keys
                .read()
                .expect("api key store lock poisoned")
                .clone(),
            webhook_endpoints: self
                .webhook_endpoints
                .read()
                .expect("webhook endpoint store lock poisoned")
                .clone(),
            checkout_sessions: self
                .checkout_sessions
                .read()
                .expect("checkout session store lock poisoned")
                .clone(),
            idempotency_keys: self
                .idempotency_keys
                .read()
                .expect("idempotency store lock poisoned")
                .clone(),
            webhook_events: self
                .webhook_events
                .read()
                .expect("webhook event store lock poisoned")
                .clone(),
            webhook_deliveries: self
                .webhook_deliveries
                .read()
                .expect("webhook delivery store lock poisoned")
                .clone(),
            next_invoice_number,
            next_chain_invoice_id,
        };

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create portal store directory");
        }

        let body = serde_json::to_string_pretty(&data).expect("failed to serialize portal store");
        std::fs::write(path, body).expect("failed to write portal store");
    }
}

#[derive(Debug, Clone, Copy)]
struct FinalityProgress {
    confirmations: u64,
    threshold: u64,
}

fn read_portal_file(path: &Path) -> Option<PortalFile> {
    if !path.exists() {
        return None;
    }

    let body = std::fs::read_to_string(path).expect("failed to read portal store");
    Some(serde_json::from_str(&body).expect("failed to parse portal store"))
}

fn chain_sync_status(reorg_exceptions: u32, indexer_stalled: bool) -> String {
    if reorg_exceptions > 0 {
        return "intervention_required".to_string();
    }

    if indexer_stalled {
        return "stalled".to_string();
    }

    "healthy".to_string()
}

fn has_operator_action_required(counts: impl IntoIterator<Item = u32>) -> bool {
    counts.into_iter().any(|count| count > 0)
}

fn stalled_count(indexer_stalled: bool) -> u32 {
    u32::from(indexer_stalled)
}

fn has_indexer_stalled(invoices: &[InvoiceRecord]) -> bool {
    invoices.iter().any(|invoice| {
        invoice.chain_invoice_id.is_some()
            && invoice.payment_tx_hash.is_some()
            && invoice.snapshot.finality_status == FinalityStatus::AwaitingFinality
    })
}

fn indexer_cursor(invoices: &[InvoiceRecord]) -> IndexerCursor {
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

fn project_paid(
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

fn apply_finality_progress(
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

fn mark_webhook_pending_if_due(invoice: &mut InvoiceRecord) {
    if invoice.snapshot.is_fulfillment_ready() {
        invoice.webhook.mark_pending_if_idle();
    }
}

fn preserve_release_status(invoice: &InvoiceRecord, snapshot: &mut SettlementSnapshot) {
    if invoice.fulfillment_release.is_some() && snapshot.is_fulfillment_ready() {
        snapshot.fulfillment_status = FulfillmentStatus::Released;
    }
}
