use chrono::{DateTime, Utc};
use shared::{
    AddressManifest, BillingCycle, BillingEntitlementStatus, BillingPaymentRecord,
    BillingPaymentStatus, BillingPlan, BillingProtocolManifest, BillingSubscription,
    BillingSubscriptionResponse, BillingSubscriptionStatus, BillingUpgradeIntentResponse,
    PaymentProject, ProjectEnvironmentKind, SubscriptionEntitlementProjectionRequest,
    contract_manifest,
};
use uuid::Uuid;

use super::PortalStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BillingSubscriptionError {
    PlanRequiresReview,
    ChainSourceOnly,
    InvalidProjection,
}

impl PortalStore {
    pub async fn billing_upgrade_intent(
        &self,
        owner_wallet: &str,
        plan: BillingPlan,
        billing_cycle: BillingCycle,
        manifest: Option<&AddressManifest>,
        _now: DateTime<Utc>,
    ) -> Result<BillingUpgradeIntentResponse, BillingSubscriptionError> {
        let protocol = self.billing_protocol(manifest);
        if !protocol.is_self_serve(plan) {
            return Err(BillingSubscriptionError::PlanRequiresReview);
        }

        let plan_code = protocol
            .plan_code(plan)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;
        let price_minor_units = protocol
            .price_minor_units(plan, billing_cycle)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;
        let period_days = protocol
            .period_days(billing_cycle)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;
        let expected_fee_bps = protocol
            .checkout_fee_bps(plan)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;

        Ok(BillingUpgradeIntentResponse {
            pass_id: None,
            owner_wallet: owner_wallet.to_string(),
            plan,
            billing_cycle,
            plan_code,
            price_minor_units,
            period_days,
            expected_fee_bps,
            charge_token_contract: manifest
                .and_then(|manifest| manifest.contracts.confidential_usd_mock.clone()),
            subscription_registry_contract: manifest
                .and_then(|manifest| manifest.contracts.private_subscription_registry.clone()),
            treasury_wallet: manifest.and_then(|manifest| manifest.platform_fee_wallet.clone()),
            privacy_note:
                "Encrypt planCode and priceMinorUnits for PrivateSubscriptionRegistry.requestSubscriptionChange."
                    .to_string(),
        })
    }

    pub async fn billing_subscription(
        &self,
        owner_wallet: &str,
        now: DateTime<Utc>,
    ) -> BillingSubscriptionResponse {
        self.billing_subscription_for_manifest(owner_wallet, None, now)
            .await
    }

    pub async fn billing_subscription_for_manifest(
        &self,
        owner_wallet: &str,
        manifest: Option<&AddressManifest>,
        now: DateTime<Utc>,
    ) -> BillingSubscriptionResponse {
        let protocol = self.billing_protocol(manifest).clone();
        let subscription = self.ensure_billing_subscription(owner_wallet, now).await;
        self.billing_response(subscription, &protocol).await
    }

    pub async fn upgrade_billing_subscription(
        &self,
        owner_wallet: &str,
        plan: BillingPlan,
        billing_cycle: BillingCycle,
        manifest: Option<&AddressManifest>,
        chain_tx_hash: Option<String>,
        subscription_check_handle: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<BillingSubscriptionResponse, BillingSubscriptionError> {
        let _ = (
            owner_wallet,
            plan,
            billing_cycle,
            manifest,
            chain_tx_hash,
            subscription_check_handle,
            now,
        );
        Err(BillingSubscriptionError::ChainSourceOnly)
    }

    pub async fn project_subscription_entitlement(
        &self,
        owner_wallet: &str,
        projection: SubscriptionEntitlementProjectionRequest,
        manifest: Option<&AddressManifest>,
        now: DateTime<Utc>,
    ) -> Result<BillingSubscriptionResponse, BillingSubscriptionError> {
        let protocol = self.billing_protocol(manifest).clone();
        if !protocol.is_self_serve(projection.plan) {
            return Err(BillingSubscriptionError::PlanRequiresReview);
        }

        let price_minor_units = protocol
            .price_minor_units(projection.plan, projection.billing_cycle)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;
        let period_days = protocol
            .period_days(projection.billing_cycle)
            .ok_or(BillingSubscriptionError::PlanRequiresReview)?;

        let pass_id = required_projection_field(&projection.pass_id)?;
        let entitlement_tx_hash = required_projection_field(&projection.entitlement_tx_hash)?;
        let subscription_check_handle =
            required_projection_field(&projection.subscription_check_handle)?;
        if projection.entitlement_version == 0 {
            return Err(BillingSubscriptionError::InvalidProjection);
        }

        let mut subscription = self.ensure_billing_subscription(owner_wallet, now).await;
        subscription.owner_wallet = owner_wallet.to_string();
        subscription.plan = projection.plan;
        subscription.billing_cycle = projection.billing_cycle;
        subscription.status = BillingSubscriptionStatus::Active;
        subscription.pass_id = Some(pass_id);
        subscription.entitlement_version = projection.entitlement_version;
        subscription.entitlement_status = BillingEntitlementStatus::Anchored;
        subscription.entitlement_tx_hash = Some(entitlement_tx_hash.clone());
        subscription.subscription_check_handle = Some(subscription_check_handle.clone());
        subscription.current_period_started_at = now;
        subscription.current_period_ends_at = next_period_end(now, period_days);
        subscription.updated_at = now;

        self.subscriptions
            .write()
            .await
            .insert(owner_key(owner_wallet), subscription.clone());
        self.record_billing_payment(
            owner_wallet,
            projection.plan,
            projection.billing_cycle,
            price_minor_units,
            entitlement_tx_hash,
            subscription_check_handle,
            now,
        )
        .await;
        self.persist().await;

        Ok(self.billing_response(subscription, &protocol).await)
    }

    pub(crate) async fn effective_billing_plan_for_owner(
        &self,
        owner_wallet: &str,
        now: DateTime<Utc>,
    ) -> BillingPlan {
        self.ensure_billing_subscription(owner_wallet, now)
            .await
            .effective_plan()
    }

    pub(crate) async fn effective_billing_plan_for_project(
        &self,
        project: &PaymentProject,
        now: DateTime<Utc>,
    ) -> BillingPlan {
        self.effective_billing_plan_for_owner(&project.owner_wallet, now)
            .await
    }

    pub(crate) async fn checkout_fee_bps_for_project(
        &self,
        project: &PaymentProject,
        environment: ProjectEnvironmentKind,
        now: DateTime<Utc>,
    ) -> Option<(BillingPlan, u16)> {
        let plan = self.effective_billing_plan_for_project(project, now).await;
        let protocol = self.billing_protocol_for_environment(environment);
        let fee_bps = protocol.checkout_fee_bps(plan)?;

        Some((plan, fee_bps))
    }

    async fn ensure_billing_subscription(
        &self,
        owner_wallet: &str,
        now: DateTime<Utc>,
    ) -> BillingSubscription {
        let subscription = {
            self.subscriptions
                .read()
                .await
                .get(&owner_key(owner_wallet))
                .cloned()
        };

        if let Some(subscription) = subscription {
            let normalized = normalize_backend_subscription(
                subscription.clone(),
                now,
                self.default_monthly_period_days(),
            );
            if normalized != subscription {
                self.subscriptions
                    .write()
                    .await
                    .insert(owner_key(owner_wallet), normalized.clone());
                self.persist().await;
            }
            return normalized;
        }

        let subscription =
            default_subscription(owner_wallet, now, self.default_monthly_period_days());
        self.subscriptions
            .write()
            .await
            .insert(owner_key(owner_wallet), subscription.clone());
        self.persist().await;
        subscription
    }

    async fn billing_response(
        &self,
        subscription: BillingSubscription,
        protocol: &BillingProtocolManifest,
    ) -> BillingSubscriptionResponse {
        BillingSubscriptionResponse {
            payments: self
                .billing_payment_history(&subscription.owner_wallet)
                .await,
            subscription,
            plans: protocol.catalog(),
        }
    }

    async fn billing_payment_history(&self, owner_wallet: &str) -> Vec<BillingPaymentRecord> {
        let mut payments = self
            .billing_payments
            .read()
            .await
            .get(&owner_key(owner_wallet))
            .cloned()
            .unwrap_or_default();
        payments.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        payments
    }

    async fn record_billing_payment(
        &self,
        owner_wallet: &str,
        plan: BillingPlan,
        billing_cycle: BillingCycle,
        amount_minor_units: u64,
        chain_tx_hash: String,
        subscription_check_handle: String,
        now: DateTime<Utc>,
    ) {
        let mut histories = self.billing_payments.write().await;
        let payments = histories.entry(owner_key(owner_wallet)).or_default();
        if payments
            .iter()
            .any(|payment| payment.chain_tx_hash.as_deref() == Some(chain_tx_hash.as_str()))
        {
            return;
        }

        payments.push(BillingPaymentRecord {
            payment_id: format!("pay_{}", Uuid::new_v4().simple()),
            owner_wallet: owner_wallet.to_string(),
            plan,
            billing_cycle,
            amount_minor_units,
            currency: "cUSDT".to_string(),
            status: BillingPaymentStatus::Succeeded,
            chain_tx_hash: Some(chain_tx_hash),
            subscription_check_handle: Some(subscription_check_handle),
            created_at: now,
        });
    }

    fn billing_protocol<'a>(
        &'a self,
        manifest: Option<&'a AddressManifest>,
    ) -> &'a BillingProtocolManifest {
        manifest
            .map(|manifest| &manifest.billing)
            .unwrap_or(&self.billing_protocol)
    }

    fn billing_protocol_for_environment(
        &self,
        environment: ProjectEnvironmentKind,
    ) -> BillingProtocolManifest {
        contract_manifest(environment.as_str())
            .ok()
            .flatten()
            .map(|manifest| manifest.billing)
            .unwrap_or_else(|| (*self.billing_protocol).clone())
    }

    fn default_monthly_period_days(&self) -> i64 {
        self.billing_protocol
            .period_days(BillingCycle::Monthly)
            .unwrap_or_default()
    }
}

fn normalize_backend_subscription(
    mut subscription: BillingSubscription,
    now: DateTime<Utc>,
    monthly_period_days: i64,
) -> BillingSubscription {
    if is_current_chain_entitlement(&subscription, now) {
        return subscription;
    }

    let changed = subscription.plan != BillingPlan::Free
        || subscription.billing_cycle != BillingCycle::Monthly
        || subscription.status != BillingSubscriptionStatus::Active
        || subscription.pass_id.is_some()
        || subscription.entitlement_version != 0
        || subscription.entitlement_status != BillingEntitlementStatus::ContractDefault
        || subscription.entitlement_tx_hash.is_some()
        || subscription.subscription_check_handle.is_some();

    if !changed {
        return subscription;
    }

    subscription.plan = BillingPlan::Free;
    subscription.billing_cycle = BillingCycle::Monthly;
    subscription.status = BillingSubscriptionStatus::Active;
    subscription.pass_id = None;
    subscription.entitlement_version = 0;
    subscription.entitlement_status = BillingEntitlementStatus::ContractDefault;
    subscription.entitlement_tx_hash = None;
    subscription.subscription_check_handle = None;
    subscription.current_period_started_at = now;
    subscription.current_period_ends_at = next_period_end(now, monthly_period_days);
    subscription.updated_at = now;
    subscription
}

fn is_current_chain_entitlement(subscription: &BillingSubscription, now: DateTime<Utc>) -> bool {
    subscription.status == BillingSubscriptionStatus::Active
        && subscription.entitlement_status == BillingEntitlementStatus::Anchored
        && subscription.entitlement_version > 0
        && subscription.current_period_ends_at > now
        && non_empty(subscription.pass_id.as_deref())
        && non_empty(subscription.entitlement_tx_hash.as_deref())
        && non_empty(subscription.subscription_check_handle.as_deref())
}

fn required_projection_field(value: &str) -> Result<String, BillingSubscriptionError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(BillingSubscriptionError::InvalidProjection);
    }

    Ok(value.to_string())
}

fn non_empty(value: Option<&str>) -> bool {
    value.is_some_and(|value| !value.trim().is_empty())
}

fn default_subscription(
    owner_wallet: &str,
    now: DateTime<Utc>,
    monthly_period_days: i64,
) -> BillingSubscription {
    BillingSubscription {
        subscription_id: format!("sub_{}", Uuid::new_v4().simple()),
        owner_wallet: owner_wallet.to_string(),
        plan: BillingPlan::Free,
        billing_cycle: BillingCycle::Monthly,
        status: BillingSubscriptionStatus::Active,
        pass_id: None,
        entitlement_version: 0,
        entitlement_status: BillingEntitlementStatus::ContractDefault,
        entitlement_tx_hash: None,
        subscription_check_handle: None,
        current_period_started_at: now,
        current_period_ends_at: next_period_end(now, monthly_period_days),
        updated_at: now,
    }
}

fn next_period_end(now: DateTime<Utc>, period_days: i64) -> DateTime<Utc> {
    now + chrono::TimeDelta::days(period_days)
}

fn owner_key(owner_wallet: &str) -> String {
    owner_wallet.to_lowercase()
}
