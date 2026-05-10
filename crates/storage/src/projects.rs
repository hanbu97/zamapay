use chrono::{DateTime, Utc};
use domain::{FinalityStatus, FulfillmentStatus, PaymentTruth, WebhookDeliveryStatus};
use serde_json::json;
use shared::{
    CheckoutBillingSnapshot, CheckoutQuoteResponse, CheckoutSession, CheckoutSessionStatus,
    ConfigureWebhookEndpointResponse, CreateCheckoutSessionRequest, CreatePaymentProjectResponse,
    CreateProjectApiKeyResponse, PaymentProject, PaymentProjectEnvironment, ProjectApiKey,
    ProjectDashboardOverview, ProjectEnvironmentKind, ProjectInvoiceAuthority, ProjectStatus,
    ProjectWebhookEndpoint, ProjectWithdrawalRecord, ProjectWithdrawalStatus,
    WebhookDeliveryRecord, WebhookEventRecord,
};
use uuid::Uuid;

use crate::pg_store::{save_payment_project_bundle_to, save_project_api_key_to};
use crate::project_support::{
    CheckoutSessionError, DEFAULT_DELIVERY_MAX_ATTEMPTS, StoredProjectApiKey, clean_base_url,
    hash_secret, merchant_registered, parse_environment, project_environment, project_summary,
    secret_preview, signer_address, signer_key_ref, webhook_secret,
};

use super::PortalStore;
use crate::invoice_seed::seeded_invoice;

impl PortalStore {
    pub async fn list_projects(&self, owner_wallet: &str) -> Vec<PaymentProject> {
        self.projects
            .read()
            .await
            .values()
            .filter(|project| project.owner_wallet.eq_ignore_ascii_case(owner_wallet))
            .cloned()
            .collect()
    }

    pub async fn create_project(
        &self,
        owner_wallet: &str,
        name: &str,
        environment: ProjectEnvironmentKind,
        webhook_url: Option<&str>,
        now: DateTime<Utc>,
    ) -> CreatePaymentProjectResponse {
        let project_id = format!("proj_{}", Uuid::new_v4().simple());
        let environment_id = format!("env_{}", Uuid::new_v4().simple());
        let authority_id = format!("auth_{}", Uuid::new_v4().simple());
        let billing_plan = self
            .effective_billing_plan_for_owner(owner_wallet, now)
            .await;
        let project = PaymentProject {
            project_id: project_id.clone(),
            name: name.to_string(),
            owner_wallet: owner_wallet.to_string(),
            default_environment: environment.clone(),
            billing_plan,
            status: ProjectStatus::Active,
            created_at: now,
            updated_at: now,
        };
        let authority = ProjectInvoiceAuthority {
            authority_id: authority_id.clone(),
            project_id: project_id.clone(),
            environment: environment.clone(),
            mode: shared::InvoiceAuthorityMode::PlatformHostedSigner,
            signer_address: signer_address(&environment),
            key_ref: signer_key_ref(&environment),
            merchant_registered: merchant_registered(&environment),
            created_at: now,
        };
        let environment_record = project_environment(
            &project_id,
            &environment_id,
            environment.clone(),
            &authority_id,
        );

        self.projects
            .write()
            .await
            .insert(project_id.clone(), project.clone());
        self.environments
            .write()
            .await
            .insert(environment_id, environment_record.clone());
        self.invoice_authorities
            .write()
            .await
            .insert(authority_id, authority.clone());

        let (webhook_endpoint, webhook_secret) = match webhook_url
            .filter(|url| !url.trim().is_empty())
        {
            Some(url) => {
                let configured = build_webhook_endpoint(&project_id, environment.clone(), url, now);
                self.webhook_endpoints.write().await.insert(
                    configured.endpoint.endpoint_id.clone(),
                    configured.endpoint.clone(),
                );
                (Some(configured.endpoint), configured.webhook_secret)
            }
            None => (None, None),
        };

        save_payment_project_bundle_to(
            &self.database,
            &self.state_key,
            &project,
            &environment_record,
            &authority,
            webhook_endpoint.as_ref(),
        )
        .await;

        CreatePaymentProjectResponse {
            project,
            environment: environment_record,
            invoice_authority: authority,
            webhook_endpoint,
            webhook_secret,
        }
    }

    pub async fn project_by_id(&self, project_id: &str) -> Option<PaymentProject> {
        self.projects.read().await.get(project_id).cloned()
    }

    pub async fn project_overview(&self, project_id: &str) -> Option<ProjectDashboardOverview> {
        let project = self.project_by_id(project_id).await?;
        let environments = self.environments_by_project(project_id).await;
        let api_keys = self.api_keys_by_project(project_id).await;
        let webhook_endpoints = self.webhook_endpoints_by_project(project_id).await;
        let checkout_sessions = self.checkout_sessions_by_project(project_id).await;
        let webhook_events = self.webhook_events_by_project(project_id).await;
        let webhook_deliveries = self.webhook_deliveries_by_project(project_id).await;
        let withdrawals = self.project_withdrawals_by_project(project_id).await;
        let summary = project_summary(&checkout_sessions, &webhook_deliveries, &withdrawals);

        Some(ProjectDashboardOverview {
            project,
            environments,
            api_keys,
            webhook_endpoints,
            checkout_sessions,
            webhook_events,
            webhook_deliveries,
            withdrawals,
            summary,
        })
    }

    pub async fn create_project_api_key(
        &self,
        project_id: &str,
        environment: ProjectEnvironmentKind,
        label: &str,
        now: DateTime<Utc>,
    ) -> Option<CreateProjectApiKeyResponse> {
        self.project_by_id(project_id).await?;

        let api_key = format!("zmp_test_{}", Uuid::new_v4().simple());
        let key_id = format!("key_{}", Uuid::new_v4().simple());
        let prefix = api_key.chars().take(18).collect::<String>();
        let key_record = ProjectApiKey {
            key_id: key_id.clone(),
            project_id: project_id.to_string(),
            environment,
            label: label.to_string(),
            prefix,
            created_at: now,
            last_used_at: None,
            revoked_at: None,
        };

        let stored_key = StoredProjectApiKey {
            record: key_record.clone(),
            secret_hash: hash_secret(&api_key),
        };
        self.api_keys
            .write()
            .await
            .insert(key_id, stored_key.clone());
        save_project_api_key_to(&self.database, &self.state_key, &stored_key).await;

        Some(CreateProjectApiKeyResponse {
            api_key,
            key_record,
        })
    }

    pub async fn revoke_project_api_key(
        &self,
        project_id: &str,
        key_id: &str,
        now: DateTime<Utc>,
    ) -> Option<ProjectApiKey> {
        let mut keys = self.api_keys.write().await;
        let stored = keys.get_mut(key_id)?;
        if stored.record.project_id != project_id {
            return None;
        }
        stored.record.revoked_at = Some(now);
        let record = stored.record.clone();
        drop(keys);
        self.persist().await;
        Some(record)
    }

    pub async fn create_project_withdrawal(
        &self,
        project_id: &str,
        amount_minor_units: u64,
        receipt: &str,
        now: DateTime<Utc>,
    ) -> Option<ProjectWithdrawalRecord> {
        self.project_by_id(project_id).await?;
        if amount_minor_units == 0 || receipt.trim().is_empty() {
            return None;
        }

        let withdrawal_id = format!("wd_{}", Uuid::new_v4().simple());
        let withdrawal = ProjectWithdrawalRecord {
            withdrawal_id: withdrawal_id.clone(),
            project_id: project_id.to_string(),
            amount_minor_units,
            status: ProjectWithdrawalStatus::Completed,
            receipt: receipt.trim().to_string(),
            created_at: now,
            completed_at: now,
        };
        self.project_withdrawals
            .write()
            .await
            .insert(withdrawal_id, withdrawal.clone());
        self.persist().await;

        Some(withdrawal)
    }

    pub async fn configure_webhook_endpoint(
        &self,
        project_id: &str,
        environment: ProjectEnvironmentKind,
        url: &str,
        now: DateTime<Utc>,
    ) -> ConfigureWebhookEndpointResponse {
        let configured = build_webhook_endpoint(project_id, environment, url, now);

        self.webhook_endpoints.write().await.insert(
            configured.endpoint.endpoint_id.clone(),
            configured.endpoint.clone(),
        );
        self.persist().await;

        configured
    }

    pub async fn update_webhook_endpoint(
        &self,
        project_id: &str,
        endpoint_id: &str,
        environment: ProjectEnvironmentKind,
        url: &str,
        enabled: bool,
        now: DateTime<Utc>,
    ) -> Option<ProjectWebhookEndpoint> {
        let mut endpoints = self.webhook_endpoints.write().await;
        let endpoint = endpoints.get_mut(endpoint_id)?;
        if endpoint.project_id != project_id {
            return None;
        }

        endpoint.environment = environment;
        endpoint.url = url.to_string();
        endpoint.enabled = enabled;
        endpoint.updated_at = now;
        let endpoint = endpoint.clone();
        drop(endpoints);
        self.persist().await;
        Some(endpoint)
    }

    pub async fn create_checkout_session(
        &self,
        project_id: &str,
        api_key: &str,
        idempotency_key: &str,
        payload: CreateCheckoutSessionRequest,
        checkout_base_url: &str,
        now: DateTime<Utc>,
    ) -> Result<CheckoutSession, CheckoutSessionError> {
        let api_key = self
            .verify_project_api_key(project_id, api_key, now)
            .await
            .ok_or(CheckoutSessionError::Unauthorized)?;
        let environment = api_key.environment;
        let idempotency_scope = format!("{project_id}:{}:{idempotency_key}", environment.as_str());
        let existing_id = {
            self.idempotency_keys
                .read()
                .await
                .get(&idempotency_scope)
                .cloned()
        };
        if let Some(existing_id) = existing_id {
            return self
                .checkout_session_by_id(&existing_id)
                .await
                .ok_or(CheckoutSessionError::NotFound);
        }

        if payload.amount_minor_units == 0
            || payload.title.trim().is_empty()
            || payload.merchant_order_id.trim().is_empty()
        {
            return Err(CheckoutSessionError::InvalidRequest);
        }
        let project = self
            .project_by_id(project_id)
            .await
            .ok_or(CheckoutSessionError::NotFound)?;
        let (plan, fee_bps) = self
            .checkout_fee_bps_for_project(&project, environment, now)
            .await
            .ok_or(CheckoutSessionError::Locked)?;
        let billing =
            CheckoutBillingSnapshot::from_gross_amount(plan, fee_bps, payload.amount_minor_units)
                .filter(|snapshot| snapshot.merchant_net_minor_units > 0)
                .ok_or(CheckoutSessionError::InvalidRequest)?;

        let environment_record = self
            .environment_for_project(project_id, &environment)
            .await
            .ok_or(CheckoutSessionError::Locked)?;
        let authority = self
            .invoice_authorities
            .read()
            .await
            .get(&environment_record.invoice_authority_id)
            .cloned()
            .ok_or(CheckoutSessionError::Locked)?;
        if !authority.merchant_registered {
            return Err(CheckoutSessionError::Locked);
        }

        let checkout_session_id = format!("cs_{}", Uuid::new_v4().simple());
        let (chain_invoice_id, chain_tx_hash) =
            match (payload.chain_invoice_id, payload.chain_tx_hash.clone()) {
                (Some(invoice_id), Some(tx_hash)) if tx_hash.starts_with("0x") => {
                    (invoice_id, tx_hash)
                }
                _ => return Err(CheckoutSessionError::InvalidRequest),
            };
        let checkout_base_url = clean_base_url(checkout_base_url);
        let checkout_url = format!("{checkout_base_url}/checkout/{checkout_session_id}");
        let expires_at = now + chrono::TimeDelta::hours(1);
        let mut invoice = seeded_invoice(
            &checkout_session_id,
            payload.title.trim(),
            "ZamaPay merchant",
            payload.amount_label.trim(),
            payload.amount_minor_units,
            payload.note.trim(),
            PaymentTruth::PendingPayment,
            FinalityStatus::NotPaid,
            FulfillmentStatus::NotReady,
        );
        invoice.project_id = Some(project_id.to_string());
        invoice.checkout_session_id = Some(checkout_session_id.clone());
        invoice.environment = Some(environment.as_str().to_string());
        invoice.external_ref = Some(payload.merchant_order_id.clone());
        invoice.chain_invoice_id = Some(chain_invoice_id);
        invoice.chain_tx_hash = Some(chain_tx_hash.clone());
        invoice.billing = Some(billing.clone());
        invoice.snapshot.invoice_id = chain_invoice_id;

        let session = CheckoutSession {
            checkout_session_id: checkout_session_id.clone(),
            project_id: project_id.to_string(),
            environment,
            merchant_order_id: payload.merchant_order_id,
            idempotency_key: idempotency_key.to_string(),
            invoice_id: checkout_session_id.clone(),
            chain_invoice_id,
            chain_tx_hash,
            checkout_url,
            title: payload.title,
            amount_label: payload.amount_label,
            amount_minor_units: payload.amount_minor_units,
            billing,
            note: payload.note,
            success_url: payload.success_url,
            cancel_url: payload.cancel_url,
            metadata: payload.metadata,
            status: CheckoutSessionStatus::Open,
            created_at: now,
            updated_at: now,
            expires_at,
        };

        self.invoices
            .write()
            .await
            .insert(checkout_session_id.clone(), invoice);
        self.checkout_sessions
            .write()
            .await
            .insert(checkout_session_id.clone(), session.clone());
        self.idempotency_keys
            .write()
            .await
            .insert(idempotency_scope, checkout_session_id);
        self.persist().await;

        Ok(session)
    }

    pub async fn checkout_quote(
        &self,
        project_id: &str,
        api_key: &str,
        amount_minor_units: u64,
        now: DateTime<Utc>,
    ) -> Result<CheckoutQuoteResponse, CheckoutSessionError> {
        if amount_minor_units == 0 {
            return Err(CheckoutSessionError::InvalidRequest);
        }

        let api_key = self
            .verify_project_api_key(project_id, api_key, now)
            .await
            .ok_or(CheckoutSessionError::Unauthorized)?;
        let environment = api_key.environment;
        let project = self
            .project_by_id(project_id)
            .await
            .ok_or(CheckoutSessionError::NotFound)?;
        let (plan, fee_bps) = self
            .checkout_fee_bps_for_project(&project, environment, now)
            .await
            .ok_or(CheckoutSessionError::Locked)?;
        let billing = CheckoutBillingSnapshot::from_gross_amount(plan, fee_bps, amount_minor_units)
            .filter(|snapshot| snapshot.merchant_net_minor_units > 0)
            .ok_or(CheckoutSessionError::InvalidRequest)?;

        let environment_record = self
            .environment_for_project(project_id, &environment)
            .await
            .ok_or(CheckoutSessionError::Locked)?;
        let authority = self
            .invoice_authorities
            .read()
            .await
            .get(&environment_record.invoice_authority_id)
            .cloned()
            .ok_or(CheckoutSessionError::Locked)?;
        if !authority.merchant_registered {
            return Err(CheckoutSessionError::Locked);
        }

        Ok(CheckoutQuoteResponse {
            billing,
            merchant_owner_wallet: project.owner_wallet,
        })
    }

    pub async fn checkout_session_by_id(
        &self,
        checkout_session_id: &str,
    ) -> Option<CheckoutSession> {
        self.checkout_sessions
            .read()
            .await
            .get(checkout_session_id)
            .cloned()
    }

    pub async fn verify_checkout_session_access(
        &self,
        project_id: &str,
        checkout_session_id: &str,
        api_key: &str,
        now: DateTime<Utc>,
    ) -> Result<CheckoutSession, CheckoutSessionError> {
        let key = self
            .verify_project_api_key(project_id, api_key, now)
            .await
            .ok_or(CheckoutSessionError::Unauthorized)?;
        let checkout = self
            .checkout_session_by_id(checkout_session_id)
            .await
            .ok_or(CheckoutSessionError::NotFound)?;
        if checkout.project_id != project_id
            || checkout.environment.as_str() != key.environment.as_str()
        {
            return Err(CheckoutSessionError::Unauthorized);
        }

        Ok(checkout)
    }

    pub async fn due_webhook_deliveries(
        &self,
        project_id: &str,
        now: DateTime<Utc>,
    ) -> Vec<WebhookDeliveryRecord> {
        self.webhook_deliveries
            .read()
            .await
            .values()
            .filter(|delivery| delivery.project_id == project_id)
            .filter(|delivery| {
                matches!(
                    delivery.status,
                    WebhookDeliveryStatus::Pending | WebhookDeliveryStatus::RetryScheduled
                )
            })
            .filter(|delivery| delivery.next_retry_at.is_none_or(|retry| retry <= now))
            .cloned()
            .collect()
    }

    pub async fn webhook_event_by_id(&self, event_id: &str) -> Option<WebhookEventRecord> {
        self.webhook_events.read().await.get(event_id).cloned()
    }

    pub async fn webhook_endpoint_by_id(
        &self,
        endpoint_id: &str,
    ) -> Option<ProjectWebhookEndpoint> {
        self.webhook_endpoints
            .read()
            .await
            .get(endpoint_id)
            .cloned()
    }

    pub async fn webhook_delivery_by_id(&self, delivery_id: &str) -> Option<WebhookDeliveryRecord> {
        self.webhook_deliveries
            .read()
            .await
            .get(delivery_id)
            .cloned()
    }

    pub async fn reschedule_webhook_delivery(
        &self,
        project_id: &str,
        delivery_id: &str,
        now: DateTime<Utc>,
    ) -> Option<WebhookDeliveryRecord> {
        let mut deliveries = self.webhook_deliveries.write().await;
        let delivery = deliveries.get_mut(delivery_id)?;
        if delivery.project_id != project_id {
            return None;
        }
        delivery.status = WebhookDeliveryStatus::Pending;
        delivery.next_retry_at = Some(now);
        let delivery = delivery.clone();
        drop(deliveries);
        self.persist().await;
        Some(delivery)
    }

    pub async fn webhook_secret_for_endpoint(&self, endpoint_id: &str) -> Option<String> {
        let endpoint = self.webhook_endpoint_by_id(endpoint_id).await?;
        Some(webhook_secret(&endpoint.project_id, endpoint_id))
    }

    pub async fn mark_webhook_delivery_result(
        &self,
        delivery_id: &str,
        signature_header: String,
        http_status: Option<u16>,
        response_body: Option<String>,
        error: Option<String>,
        now: DateTime<Utc>,
    ) -> Option<WebhookDeliveryRecord> {
        let mut deliveries = self.webhook_deliveries.write().await;
        let delivery = deliveries.get_mut(delivery_id)?;
        delivery.signature_header = Some(signature_header);
        delivery.http_status = http_status;
        delivery.response_body = response_body;
        delivery.error = error;
        delivery.attempt_count += 1;

        if http_status.is_some_and(|status| (200..300).contains(&status)) {
            delivery.status = WebhookDeliveryStatus::Delivered;
            delivery.next_retry_at = None;
            delivery.delivered_at = Some(now);
        } else if delivery.attempt_count >= DEFAULT_DELIVERY_MAX_ATTEMPTS {
            delivery.status = WebhookDeliveryStatus::DeadLetter;
            delivery.next_retry_at = None;
        } else {
            delivery.status = WebhookDeliveryStatus::RetryScheduled;
            delivery.next_retry_at =
                Some(now + chrono::TimeDelta::seconds(30 * i64::from(delivery.attempt_count)));
        }

        let delivery = delivery.clone();
        drop(deliveries);
        self.persist().await;
        Some(delivery)
    }

    pub async fn create_test_webhook_delivery(
        &self,
        project_id: &str,
        endpoint_id: &str,
        environment: ProjectEnvironmentKind,
        now: DateTime<Utc>,
    ) -> Option<WebhookDeliveryRecord> {
        self.project_by_id(project_id).await?;
        let endpoint = self
            .webhook_endpoints_by_project(project_id)
            .await
            .into_iter()
            .find(|endpoint| {
                endpoint.endpoint_id == endpoint_id
                    && endpoint.environment.as_str() == environment.as_str()
                    && endpoint.enabled
            })?;
        let event_id = format!("evt_{}", Uuid::new_v4().simple());
        let delivery_id = format!("del_{}", Uuid::new_v4().simple());
        let event = WebhookEventRecord {
            event_id: event_id.clone(),
            project_id: project_id.to_string(),
            environment: environment.clone(),
            event_type: "webhook.test".to_string(),
            subject_type: "project".to_string(),
            subject_id: project_id.to_string(),
            payload: json!({
                "event": "webhook.test",
                "projectId": project_id,
                "createdAt": now,
            }),
            created_at: now,
        };
        let delivery = WebhookDeliveryRecord {
            delivery_id: delivery_id.clone(),
            event_id,
            endpoint_id: endpoint.endpoint_id,
            project_id: project_id.to_string(),
            environment,
            attempt_count: 0,
            status: WebhookDeliveryStatus::Pending,
            signature_header: None,
            http_status: None,
            response_body: None,
            error: None,
            next_retry_at: None,
            created_at: now,
            delivered_at: None,
        };
        self.webhook_events
            .write()
            .await
            .insert(event.event_id.clone(), event);
        self.webhook_deliveries
            .write()
            .await
            .insert(delivery_id, delivery.clone());
        self.persist().await;
        Some(delivery)
    }

    pub(crate) async fn enqueue_webhook_event_if_ready(&self, invoice: &shared::InvoiceRecord) {
        if !invoice.snapshot.is_fulfillment_ready() {
            return;
        }

        let (Some(project_id), Some(checkout_session_id), Some(environment)) = (
            invoice.project_id.as_deref(),
            invoice.checkout_session_id.as_deref(),
            invoice.environment.as_deref(),
        ) else {
            return;
        };
        let environment = parse_environment(environment);
        let subject_key = format!("{project_id}:{checkout_session_id}:invoice.fulfillment_ready");
        if self
            .webhook_events
            .read()
            .await
            .values()
            .any(|event| event.subject_id == subject_key)
        {
            return;
        }

        let now = Utc::now();
        let event_id = format!("evt_{}", Uuid::new_v4().simple());
        let event = WebhookEventRecord {
            event_id: event_id.clone(),
            project_id: project_id.to_string(),
            environment: environment.clone(),
            event_type: "invoice.fulfillment_ready".to_string(),
            subject_type: "checkout_session".to_string(),
            subject_id: subject_key,
            payload: json!({
                "event": "invoice.fulfillment_ready",
                "invoiceId": invoice.invoice_id,
                "checkoutSessionId": checkout_session_id,
                "projectId": project_id,
                "chainInvoiceId": invoice.chain_invoice_id,
                "chainTxHash": invoice.chain_tx_hash,
                "paymentTxHash": invoice.payment_tx_hash,
                "amountMinorUnits": invoice.amount_minor_units,
                "amountLabel": invoice.amount_label,
                "billing": invoice.billing,
                "paymentTruth": invoice.snapshot.payment_truth,
                "finalityStatus": invoice.snapshot.finality_status,
                "fulfillmentStatus": invoice.snapshot.fulfillment_status,
                "createdAt": now,
            }),
            created_at: now,
        };

        self.webhook_events
            .write()
            .await
            .insert(event_id.clone(), event);

        for endpoint in self.webhook_endpoints_by_project(project_id).await {
            if !endpoint.enabled || endpoint.environment.as_str() != environment.as_str() {
                continue;
            }

            let delivery_id = format!("del_{}", Uuid::new_v4().simple());
            let delivery = WebhookDeliveryRecord {
                delivery_id: delivery_id.clone(),
                event_id: event_id.clone(),
                endpoint_id: endpoint.endpoint_id,
                project_id: project_id.to_string(),
                environment: environment.clone(),
                attempt_count: 0,
                status: WebhookDeliveryStatus::Pending,
                signature_header: None,
                http_status: None,
                response_body: None,
                error: None,
                next_retry_at: None,
                created_at: now,
                delivered_at: None,
            };
            self.webhook_deliveries
                .write()
                .await
                .insert(delivery_id, delivery);
        }

        if let Some(session_id) = invoice.checkout_session_id.as_deref() {
            if let Some(session) = self.checkout_sessions.write().await.get_mut(session_id) {
                session.status = CheckoutSessionStatus::Paid;
                session.updated_at = now;
            }
        }
    }

    async fn verify_project_api_key(
        &self,
        project_id: &str,
        api_key: &str,
        now: DateTime<Utc>,
    ) -> Option<ProjectApiKey> {
        let prefix = api_key.chars().take(18).collect::<String>();
        let secret_hash = hash_secret(api_key);
        let mut keys = self.api_keys.write().await;
        let stored = keys.values_mut().find(|stored| {
            stored.record.project_id == project_id
                && stored.record.prefix == prefix
                && stored.secret_hash == secret_hash
                && stored.record.revoked_at.is_none()
        })?;
        stored.record.last_used_at = Some(now);
        Some(stored.record.clone())
    }

    async fn api_keys_by_project(&self, project_id: &str) -> Vec<ProjectApiKey> {
        self.api_keys
            .read()
            .await
            .values()
            .filter(|stored| stored.record.project_id == project_id)
            .map(|stored| stored.record.clone())
            .collect()
    }

    async fn webhook_endpoints_by_project(&self, project_id: &str) -> Vec<ProjectWebhookEndpoint> {
        self.webhook_endpoints
            .read()
            .await
            .values()
            .filter(|endpoint| endpoint.project_id == project_id)
            .cloned()
            .collect()
    }

    async fn checkout_sessions_by_project(&self, project_id: &str) -> Vec<CheckoutSession> {
        let mut sessions: Vec<_> = self
            .checkout_sessions
            .read()
            .await
            .values()
            .filter(|session| session.project_id == project_id)
            .cloned()
            .collect();
        sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        sessions
    }

    async fn webhook_events_by_project(&self, project_id: &str) -> Vec<WebhookEventRecord> {
        self.webhook_events
            .read()
            .await
            .values()
            .filter(|event| event.project_id == project_id)
            .cloned()
            .collect()
    }

    async fn webhook_deliveries_by_project(&self, project_id: &str) -> Vec<WebhookDeliveryRecord> {
        self.webhook_deliveries
            .read()
            .await
            .values()
            .filter(|delivery| delivery.project_id == project_id)
            .cloned()
            .collect()
    }

    async fn project_withdrawals_by_project(
        &self,
        project_id: &str,
    ) -> Vec<ProjectWithdrawalRecord> {
        self.project_withdrawals
            .read()
            .await
            .values()
            .filter(|withdrawal| withdrawal.project_id == project_id)
            .cloned()
            .collect()
    }

    async fn environments_by_project(&self, project_id: &str) -> Vec<PaymentProjectEnvironment> {
        self.environments
            .read()
            .await
            .values()
            .filter(|environment| environment.project_id == project_id)
            .cloned()
            .collect()
    }

    async fn environment_for_project(
        &self,
        project_id: &str,
        kind: &ProjectEnvironmentKind,
    ) -> Option<PaymentProjectEnvironment> {
        self.environments_by_project(project_id)
            .await
            .into_iter()
            .find(|environment| environment.environment.as_str() == kind.as_str())
    }
}

fn build_webhook_endpoint(
    project_id: &str,
    environment: ProjectEnvironmentKind,
    url: &str,
    now: DateTime<Utc>,
) -> ConfigureWebhookEndpointResponse {
    let endpoint_id = format!("we_{}", Uuid::new_v4().simple());
    let webhook_secret = webhook_secret(project_id, &endpoint_id);
    let endpoint = ProjectWebhookEndpoint {
        endpoint_id,
        project_id: project_id.to_string(),
        environment,
        url: url.to_string(),
        enabled: true,
        secret_preview: secret_preview(&webhook_secret),
        created_at: now,
        updated_at: now,
    };

    ConfigureWebhookEndpointResponse {
        endpoint,
        webhook_secret: Some(webhook_secret),
    }
}
