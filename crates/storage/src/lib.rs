use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use domain::{
    DecryptJobStatus, FinalityStatus, FulfillmentStatus, NONCE_TTL_SECONDS, PaymentTruth,
    SettlementSnapshot, WebhookDeliveryOutcome, WebhookDeliveryStatus, build_login_message,
};
use sea_orm::DatabaseConnection;
use shared::{
    BillingPaymentRecord, BillingProtocolManifest, BillingSubscription, CheckoutSession,
    DashboardOverview, DashboardSummary, DecryptCallbackOutcome, DecryptRequestSnapshot, EvmChain,
    EvmChainToken, EvmIndexerCursor, EvmPaymentIntent, EvmRpcNode, EvmSettlementContract,
    EvmSettlementLedgerEntry, FulfillmentReleaseAudit, InvoiceRecord, OperatorDiagnostics,
    PaymentProject, PaymentProjectEnvironment, PaymentRail, ProjectInvoiceAuthority,
    ProjectPaymentRailSetting, ProjectWebhookEndpoint, ProjectWithdrawalRecord, SessionUser,
    WebhookDeliveryAttemptRecord, WebhookDeliveryRecord, WebhookEndpointSecretRecord,
    WebhookEndpointSecretStatus, WebhookEventRecord, contract_manifest,
};
use tokio::sync::RwLock;
use uuid::Uuid;

mod billing;
mod evm_rail;
mod invoice_seed;
mod pg_store;
mod project_support;
mod projections;
mod projects;
pub use billing::BillingSubscriptionError;
pub use project_support::{CheckoutSessionError, ProjectWithdrawalScope};

use invoice_seed::seeded_invoice;
use pg_store::{
    PortalRecordSet, load_portal_records_from, open_portal_database, save_portal_records_to,
};
use projections::{
    FinalityProgress, apply_finality_progress, chain_sync_status, has_indexer_stalled,
    has_operator_action_required, indexer_cursor, mark_webhook_pending_if_due,
    preserve_release_status, project_paid, stalled_count,
};

const DATABASE_URL_ENV: &str = "DATABASE_URL";
const PORTAL_STATE_KEY_ENV: &str = "ZAMAPAY_PORTAL_STATE_KEY";
const DEFAULT_PORTAL_STATE_KEY: &str = "portal";

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
pub struct AuthStore {
    challenges: Arc<RwLock<HashMap<String, StoredChallenge>>>,
    sessions: Arc<RwLock<HashMap<Uuid, StoredSession>>>,
}

impl AuthStore {
    pub async fn issue_challenge(&self, address: &str, now: DateTime<Utc>) -> StoredChallenge {
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
            .await
            .insert(address.to_lowercase(), challenge.clone());

        challenge
    }

    pub async fn find_challenge(&self, address: &str) -> Option<StoredChallenge> {
        self.challenges
            .read()
            .await
            .get(&address.to_lowercase())
            .cloned()
    }

    pub async fn consume_challenge(&self, address: &str) {
        if let Some(existing) = self
            .challenges
            .write()
            .await
            .get_mut(&address.to_lowercase())
        {
            existing.consumed = true;
        }
    }

    pub async fn create_session(&self, address: &str, now: DateTime<Utc>) -> StoredSession {
        let session = StoredSession {
            user: SessionUser {
                address: address.to_string(),
                session_id: Uuid::new_v4(),
                issued_at: now,
            },
        };

        self.sessions
            .write()
            .await
            .insert(session.user.session_id, session.clone());

        session
    }

    pub async fn find_session(&self, session_id: &Uuid) -> Option<StoredSession> {
        self.sessions.read().await.get(session_id).cloned()
    }

    pub async fn delete_session(&self, session_id: &Uuid) {
        self.sessions.write().await.remove(session_id);
    }
}

#[derive(Debug, Clone)]
pub struct PortalStore {
    invoices: Arc<RwLock<HashMap<String, InvoiceRecord>>>,
    projects: Arc<RwLock<HashMap<String, PaymentProject>>>,
    subscriptions: Arc<RwLock<HashMap<String, BillingSubscription>>>,
    billing_payments: Arc<RwLock<HashMap<String, Vec<BillingPaymentRecord>>>>,
    billing_protocol: Arc<BillingProtocolManifest>,
    evm_chains: Arc<RwLock<HashMap<u64, EvmChain>>>,
    evm_chain_tokens: Arc<RwLock<HashMap<String, EvmChainToken>>>,
    evm_rpc_nodes: Arc<RwLock<HashMap<String, EvmRpcNode>>>,
    evm_settlement_contracts: Arc<RwLock<HashMap<String, EvmSettlementContract>>>,
    evm_payment_intents: Arc<RwLock<HashMap<String, EvmPaymentIntent>>>,
    evm_settlement_ledger: Arc<RwLock<HashMap<String, EvmSettlementLedgerEntry>>>,
    evm_indexer_cursors: Arc<RwLock<HashMap<String, EvmIndexerCursor>>>,
    environments: Arc<RwLock<HashMap<String, PaymentProjectEnvironment>>>,
    payment_rail_settings: Arc<RwLock<HashMap<String, ProjectPaymentRailSetting>>>,
    invoice_authorities: Arc<RwLock<HashMap<String, ProjectInvoiceAuthority>>>,
    api_keys: Arc<RwLock<HashMap<String, project_support::StoredProjectApiKey>>>,
    webhook_endpoints: Arc<RwLock<HashMap<String, ProjectWebhookEndpoint>>>,
    webhook_endpoint_secrets: Arc<RwLock<HashMap<String, WebhookEndpointSecretRecord>>>,
    checkout_sessions: Arc<RwLock<HashMap<String, CheckoutSession>>>,
    idempotency_keys: Arc<RwLock<HashMap<String, String>>>,
    webhook_events: Arc<RwLock<HashMap<String, WebhookEventRecord>>>,
    webhook_deliveries: Arc<RwLock<HashMap<String, WebhookDeliveryRecord>>>,
    webhook_delivery_attempts: Arc<RwLock<HashMap<String, WebhookDeliveryAttemptRecord>>>,
    project_withdrawals: Arc<RwLock<HashMap<String, ProjectWithdrawalRecord>>>,
    next_invoice_number: Arc<RwLock<u64>>,
    database: Arc<DatabaseConnection>,
    state_key: Arc<String>,
}

#[derive(Debug, Clone)]
pub enum DecryptRequestProjection {
    Created(InvoiceRecord),
    AlreadyPending(InvoiceRecord),
    NotPaid(InvoiceRecord),
}

impl PortalStore {
    pub async fn from_env() -> Self {
        let database_url = std::env::var(DATABASE_URL_ENV).unwrap_or_else(|_| {
            panic!("{DATABASE_URL_ENV} is required for the portal Postgres store")
        });
        assert!(
            !database_url.trim().is_empty(),
            "{DATABASE_URL_ENV} cannot be empty for the portal Postgres store"
        );
        let state_key = std::env::var(PORTAL_STATE_KEY_ENV)
            .ok()
            .filter(|key| !key.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_PORTAL_STATE_KEY.to_string());
        Self::connect_with_state_key(database_url, state_key).await
    }

    pub async fn connect(database_url: impl Into<String>) -> Self {
        Self::connect_with_state_key(database_url, DEFAULT_PORTAL_STATE_KEY).await
    }

    pub async fn connect_with_state_key(
        database_url: impl Into<String>,
        state_key: impl Into<String>,
    ) -> Self {
        let database_url = database_url.into();
        let state_key = state_key.into();
        let database = open_portal_database(&database_url).await;
        let mut records = load_portal_records_from(&database, &state_key).await;
        evm_rail::seed_evm_catalog(&mut records);
        let migrated_webhook_secrets = migrate_webhook_endpoint_secrets(&mut records);
        let store = Self::from_record_set(records, database, state_key);
        if migrated_webhook_secrets {
            store.persist().await;
        }
        store
    }

    fn from_record_set(
        records: PortalRecordSet,
        database: DatabaseConnection,
        state_key: String,
    ) -> Self {
        Self {
            invoices: Arc::new(RwLock::new(records.invoices)),
            projects: Arc::new(RwLock::new(records.projects)),
            subscriptions: Arc::new(RwLock::new(records.subscriptions)),
            billing_payments: Arc::new(RwLock::new(records.billing_payments)),
            billing_protocol: Arc::new(contract_billing_protocol()),
            evm_chains: Arc::new(RwLock::new(records.evm_chains)),
            evm_chain_tokens: Arc::new(RwLock::new(records.evm_chain_tokens)),
            evm_rpc_nodes: Arc::new(RwLock::new(records.evm_rpc_nodes)),
            evm_settlement_contracts: Arc::new(RwLock::new(records.evm_settlement_contracts)),
            evm_payment_intents: Arc::new(RwLock::new(records.evm_payment_intents)),
            evm_settlement_ledger: Arc::new(RwLock::new(records.evm_settlement_ledger)),
            evm_indexer_cursors: Arc::new(RwLock::new(records.evm_indexer_cursors)),
            environments: Arc::new(RwLock::new(records.environments)),
            payment_rail_settings: Arc::new(RwLock::new(records.payment_rail_settings)),
            invoice_authorities: Arc::new(RwLock::new(records.invoice_authorities)),
            api_keys: Arc::new(RwLock::new(records.api_keys)),
            webhook_endpoints: Arc::new(RwLock::new(records.webhook_endpoints)),
            webhook_endpoint_secrets: Arc::new(RwLock::new(records.webhook_endpoint_secrets)),
            checkout_sessions: Arc::new(RwLock::new(records.checkout_sessions)),
            idempotency_keys: Arc::new(RwLock::new(records.idempotency_keys)),
            webhook_events: Arc::new(RwLock::new(records.webhook_events)),
            webhook_deliveries: Arc::new(RwLock::new(records.webhook_deliveries)),
            webhook_delivery_attempts: Arc::new(RwLock::new(records.webhook_delivery_attempts)),
            project_withdrawals: Arc::new(RwLock::new(records.project_withdrawals)),
            next_invoice_number: Arc::new(RwLock::new(records.next_invoice_number)),
            database: Arc::new(database),
            state_key: Arc::new(state_key),
        }
    }

    pub async fn dashboard_overview(&self, merchant_address: &str) -> DashboardOverview {
        let invoices = self.invoices.read().await;
        let invoice_list = invoices.values().cloned().collect::<Vec<_>>();

        DashboardOverview {
            merchant_name: "ZamaPay merchant".to_string(),
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

    pub async fn invoice_by_id(&self, invoice_id: &str) -> Option<InvoiceRecord> {
        self.invoices.read().await.get(invoice_id).cloned()
    }

    pub async fn invoice_by_chain_invoice_id(
        &self,
        chain_invoice_id: u64,
    ) -> Option<InvoiceRecord> {
        let invoices = self.invoices.read().await;
        let sessions = self.checkout_sessions.read().await;
        invoices
            .values()
            .filter(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))
            .max_by_key(|invoice| chain_invoice_rank(invoice, &sessions))
            .cloned()
    }

    pub async fn create_invoice(
        &self,
        title: &str,
        amount_label: &str,
        amount_minor_units: u64,
        note: &str,
        external_ref: Option<&str>,
        chain_invoice_id: Option<u64>,
        chain_tx_hash: Option<&str>,
    ) -> InvoiceRecord {
        let invoice_id = match external_ref.filter(|reference| !reference.trim().is_empty()) {
            Some(reference) => reference.to_string(),
            None => {
                let mut next_invoice_number = self.next_invoice_number.write().await;
                let next_invoice_id = format!("invoice-{:04}", *next_invoice_number);
                *next_invoice_number += 1;
                next_invoice_id
            }
        };

        let mut invoice = seeded_invoice(
            &invoice_id,
            title,
            "ZamaPay merchant",
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
            .await
            .insert(invoice_id, invoice.clone());
        self.persist().await;

        invoice
    }

    pub async fn project_invoice_paid(
        &self,
        invoice_id: &str,
        chain_invoice_id: Option<u64>,
        payment_tx_hash: &str,
        payer_address: &str,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().await;
        let invoice = invoices.get_mut(invoice_id)?;
        if invoice.payment_rail != PaymentRail::ZamaPrivate {
            return None;
        }

        project_paid(invoice, chain_invoice_id, payment_tx_hash, payer_address);
        let invoice = invoice.clone();
        drop(invoices);
        self.persist().await;

        Some(invoice)
    }

    pub async fn project_chain_invoice_paid(
        &self,
        chain_invoice_id: u64,
        payment_tx_hash: &str,
        payer_address: &str,
    ) -> Option<InvoiceRecord> {
        let invoice_id = self
            .latest_invoice_id_for_chain_invoice(chain_invoice_id)
            .await?;
        let mut invoices = self.invoices.write().await;
        let invoice = invoices.get_mut(&invoice_id)?;
        if invoice.payment_rail != PaymentRail::ZamaPrivate {
            return None;
        }

        project_paid(
            invoice,
            Some(chain_invoice_id),
            payment_tx_hash,
            payer_address,
        );
        let invoice = invoice.clone();
        drop(invoices);
        self.persist().await;

        Some(invoice)
    }

    pub async fn project_chain_invoice_snapshot(
        &self,
        chain_invoice_id: u64,
        snapshot: SettlementSnapshot,
    ) -> Option<InvoiceRecord> {
        self.project_chain_invoice_snapshot_with_progress(chain_invoice_id, snapshot, None)
            .await
    }

    pub async fn project_chain_invoice_finality_snapshot(
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
        .await
    }

    async fn project_chain_invoice_snapshot_with_progress(
        &self,
        chain_invoice_id: u64,
        mut snapshot: SettlementSnapshot,
        progress: Option<FinalityProgress>,
    ) -> Option<InvoiceRecord> {
        let invoice_id = self
            .latest_invoice_id_for_chain_invoice(chain_invoice_id)
            .await?;
        let mut invoices = self.invoices.write().await;
        let invoice = invoices.get_mut(&invoice_id)?;

        preserve_release_status(invoice, &mut snapshot);
        apply_finality_progress(invoice, &snapshot, progress);
        invoice.snapshot = snapshot;
        mark_webhook_pending_if_due(invoice);
        let invoice = invoice.clone();
        drop(invoices);
        self.enqueue_webhook_event_if_ready(&invoice).await;
        self.persist().await;

        Some(invoice)
    }

    pub async fn project_chain_invoice_webhook_delivery(
        &self,
        chain_invoice_id: u64,
        outcome: WebhookDeliveryOutcome,
        max_attempts: u32,
    ) -> Option<InvoiceRecord> {
        let invoice_id = self
            .latest_invoice_id_for_chain_invoice(chain_invoice_id)
            .await?;
        let mut invoices = self.invoices.write().await;
        let invoice = invoices.get_mut(&invoice_id)?;

        invoice.webhook.apply_delivery(outcome, max_attempts);
        let invoice = invoice.clone();
        drop(invoices);
        self.persist().await;

        Some(invoice)
    }

    pub async fn request_invoice_decrypt(
        &self,
        invoice_id: &str,
        requested_at: DateTime<Utc>,
    ) -> Option<DecryptRequestProjection> {
        let mut invoices = self.invoices.write().await;
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
            self.persist().await;
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
        self.persist().await;

        Some(DecryptRequestProjection::Created(invoice))
    }

    pub async fn project_decrypt_callback(
        &self,
        request_id: &str,
        outcome: DecryptCallbackOutcome,
        callback_sender: &str,
        completed_at: DateTime<Utc>,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().await;
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
            self.persist().await;
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
        self.persist().await;

        Some(invoice)
    }

    pub async fn release_fulfillment(
        &self,
        invoice_id: &str,
        released_at: DateTime<Utc>,
        artifact_count: u32,
    ) -> Option<InvoiceRecord> {
        let mut invoices = self.invoices.write().await;
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
        self.persist().await;

        Some(invoice)
    }

    pub async fn operator_diagnostics(&self, operator_auth_rejections: u32) -> OperatorDiagnostics {
        let invoices = self
            .invoices
            .read()
            .await
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

    async fn persist(&self) {
        let invoices = self.invoices.read().await.clone();
        let next_invoice_number = *self.next_invoice_number.read().await;
        let records = PortalRecordSet {
            invoices,
            projects: self.projects.read().await.clone(),
            subscriptions: self.subscriptions.read().await.clone(),
            billing_payments: self.billing_payments.read().await.clone(),
            evm_chains: self.evm_chains.read().await.clone(),
            evm_chain_tokens: self.evm_chain_tokens.read().await.clone(),
            evm_rpc_nodes: self.evm_rpc_nodes.read().await.clone(),
            evm_settlement_contracts: self.evm_settlement_contracts.read().await.clone(),
            evm_payment_intents: self.evm_payment_intents.read().await.clone(),
            evm_settlement_ledger: self.evm_settlement_ledger.read().await.clone(),
            evm_indexer_cursors: self.evm_indexer_cursors.read().await.clone(),
            environments: self.environments.read().await.clone(),
            payment_rail_settings: self.payment_rail_settings.read().await.clone(),
            invoice_authorities: self.invoice_authorities.read().await.clone(),
            api_keys: self.api_keys.read().await.clone(),
            webhook_endpoints: self.webhook_endpoints.read().await.clone(),
            webhook_endpoint_secrets: self.webhook_endpoint_secrets.read().await.clone(),
            checkout_sessions: self.checkout_sessions.read().await.clone(),
            idempotency_keys: self.idempotency_keys.read().await.clone(),
            webhook_events: self.webhook_events.read().await.clone(),
            webhook_deliveries: self.webhook_deliveries.read().await.clone(),
            webhook_delivery_attempts: self.webhook_delivery_attempts.read().await.clone(),
            project_withdrawals: self.project_withdrawals.read().await.clone(),
            next_invoice_number,
        };

        save_portal_records_to(&self.database, &self.state_key, &records).await;
    }

    async fn latest_invoice_id_for_chain_invoice(&self, chain_invoice_id: u64) -> Option<String> {
        let invoices = self.invoices.read().await;
        let sessions = self.checkout_sessions.read().await;
        invoices
            .values()
            .filter(|invoice| invoice.chain_invoice_id == Some(chain_invoice_id))
            .max_by_key(|invoice| chain_invoice_rank(invoice, &sessions))
            .map(|invoice| invoice.invoice_id.clone())
    }
}

fn chain_invoice_rank(
    invoice: &InvoiceRecord,
    sessions: &HashMap<String, CheckoutSession>,
) -> (Option<DateTime<Utc>>, u64, String) {
    let created_at = invoice
        .checkout_session_id
        .as_ref()
        .and_then(|session_id| sessions.get(session_id))
        .map(|session| session.created_at);
    (
        created_at,
        invoice.snapshot.invoice_id,
        invoice.invoice_id.clone(),
    )
}

fn migrate_webhook_endpoint_secrets(records: &mut PortalRecordSet) -> bool {
    let mut migrated = false;
    for endpoint in records.webhook_endpoints.values() {
        let has_current = records.webhook_endpoint_secrets.values().any(|secret| {
            secret.endpoint_id == endpoint.endpoint_id
                && secret.status == WebhookEndpointSecretStatus::Current
        });
        if has_current {
            continue;
        }
        let secret = project_support::webhook_secret(&endpoint.project_id, &endpoint.endpoint_id);
        let record = WebhookEndpointSecretRecord {
            secret_id: format!(
                "wsec_migrated_{}",
                project_support::hash_secret(&format!(
                    "{}:{}",
                    endpoint.project_id, endpoint.endpoint_id
                ))
            ),
            endpoint_id: endpoint.endpoint_id.clone(),
            project_id: endpoint.project_id.clone(),
            status: WebhookEndpointSecretStatus::Current,
            secret_ciphertext: project_support::encrypt_webhook_secret(&secret),
            secret_preview: project_support::secret_preview(&secret),
            migrated_from_deterministic: true,
            created_at: endpoint.created_at,
            revealed_at: None,
            retired_at: None,
            expires_at: None,
        };
        records
            .webhook_endpoint_secrets
            .insert(record.secret_id.clone(), record);
        migrated = true;
    }
    migrated
}

fn contract_billing_protocol() -> BillingProtocolManifest {
    contract_manifest(
        &std::env::var("ZAMAPAY_RUNTIME_PROFILE").unwrap_or_else(|_| "local-dev".to_string()),
    )
    .ok()
    .flatten()
    .map(|manifest| manifest.billing)
    .unwrap_or_default()
}
