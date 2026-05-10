use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{BillingCycle, BillingPlan, BillingPlanCatalogEntry};

#[allow(dead_code)]
mod generated_contracts {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../generated/clients/rust/contracts.rs"
    ));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressManifest {
    pub network: String,
    pub chain_id: Option<u64>,
    pub contracts: ContractAddresses,
    pub generated_at: String,
    #[serde(default)]
    pub deployer: Option<String>,
    #[serde(default)]
    pub platform_fee_wallet: Option<String>,
    #[serde(default)]
    pub billing: BillingProtocolManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractAddresses {
    #[serde(rename = "MerchantRegistry")]
    pub merchant_registry: Option<String>,
    #[serde(rename = "ConfidentialUSDMock")]
    pub confidential_usd_mock: Option<String>,
    #[serde(rename = "SubscriptionPass")]
    #[serde(default)]
    pub subscription_pass: Option<String>,
    #[serde(rename = "PrivateSubscriptionRegistry")]
    #[serde(default)]
    pub private_subscription_registry: Option<String>,
    #[serde(rename = "PrivateCheckoutSettlement")]
    #[serde(default)]
    pub private_checkout_settlement: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingProtocolManifest {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub default_fee_bps: Option<u16>,
    #[serde(default)]
    pub monthly_period_seconds: Option<u64>,
    #[serde(default)]
    pub annual_period_seconds: Option<u64>,
    #[serde(default)]
    pub plans: Vec<BillingPlanProtocolTerms>,
}

impl BillingProtocolManifest {
    pub fn plan_terms(&self, plan: BillingPlan) -> Option<&BillingPlanProtocolTerms> {
        self.plans.iter().find(|terms| terms.plan == plan)
    }

    pub fn catalog(&self) -> Vec<BillingPlanCatalogEntry> {
        BillingPlan::all()
            .into_iter()
            .map(|plan| {
                let terms = self.plan_terms(plan);
                let monthly_price_minor_units =
                    terms.and_then(|terms| terms.monthly_price_minor_units);
                let annual_price_minor_units =
                    terms.and_then(|terms| terms.annual_price_minor_units);

                BillingPlanCatalogEntry {
                    plan,
                    name: plan.display_name().to_string(),
                    plan_code: terms.and_then(|terms| terms.plan_code),
                    checkout_fee_bps: terms.and_then(|terms| terms.checkout_fee_bps),
                    monthly_price_minor_units,
                    annual_price_minor_units,
                    monthly_price_usd: whole_usd_from_minor_units(monthly_price_minor_units),
                    annual_price_usd: whole_usd_from_minor_units(annual_price_minor_units),
                    self_serve: terms.is_some_and(|terms| terms.self_serve),
                    description: plan.description().to_string(),
                }
            })
            .collect()
    }

    pub fn checkout_fee_bps(&self, plan: BillingPlan) -> Option<u16> {
        self.plan_terms(plan)
            .and_then(|terms| terms.checkout_fee_bps)
            .or(match plan {
                BillingPlan::Free => self.default_fee_bps,
                BillingPlan::Growth | BillingPlan::Enterprise => None,
            })
    }

    pub fn plan_code(&self, plan: BillingPlan) -> Option<u16> {
        self.plan_terms(plan).and_then(|terms| terms.plan_code)
    }

    pub fn price_minor_units(&self, plan: BillingPlan, cycle: BillingCycle) -> Option<u64> {
        let terms = self.plan_terms(plan)?;

        match cycle {
            BillingCycle::Monthly => terms.monthly_price_minor_units,
            BillingCycle::Annual => terms.annual_price_minor_units,
        }
    }

    pub fn period_days(&self, cycle: BillingCycle) -> Option<i64> {
        let seconds = match cycle {
            BillingCycle::Monthly => self.monthly_period_seconds,
            BillingCycle::Annual => self.annual_period_seconds,
        }?;

        i64::try_from(seconds / 86_400).ok()
    }

    pub fn is_self_serve(&self, plan: BillingPlan) -> bool {
        self.plan_terms(plan)
            .is_some_and(|terms| terms.self_serve && terms.plan_code.is_some())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingPlanProtocolTerms {
    pub plan: BillingPlan,
    #[serde(default)]
    pub plan_code: Option<u16>,
    #[serde(default)]
    pub checkout_fee_bps: Option<u16>,
    #[serde(default)]
    pub monthly_price_minor_units: Option<u64>,
    #[serde(default)]
    pub annual_price_minor_units: Option<u64>,
    #[serde(default)]
    pub self_serve: bool,
}

fn whole_usd_from_minor_units(amount: Option<u64>) -> Option<u32> {
    let amount = amount?;
    if amount % 1_000000 != 0 {
        return None;
    }

    u32::try_from(amount / 1_000000).ok()
}

pub fn normalize_contract_environment(environment: &str) -> Option<&'static str> {
    let normalized = environment.trim().to_ascii_lowercase().replace('_', "-");
    match normalized.as_str() {
        "" | "dev" | "development" | "hardhat" | "local" | "localhost" | "local-dev" => {
            Some("local-dev")
        }
        "public-testnet" | "sepolia" | "test" | "testnet" => Some("sepolia"),
        _ => None,
    }
}

pub fn local_dev_contract_manifest() -> Result<AddressManifest, serde_json::Error> {
    contract_manifest("local-dev")
        .map(|manifest| manifest.expect("generated local-dev contract manifest should be present"))
}

pub fn contract_manifest(environment: &str) -> Result<Option<AddressManifest>, serde_json::Error> {
    let Some(normalized) = normalize_contract_environment(environment) else {
        return Ok(None);
    };

    let manifests: HashMap<String, AddressManifest> =
        serde_json::from_str(generated_contracts::ADDRESS_MANIFESTS_JSON)?;
    Ok(manifests.get(normalized).cloned())
}

#[cfg(test)]
mod tests {
    use super::{contract_manifest, local_dev_contract_manifest, normalize_contract_environment};
    use crate::BillingPlan;

    #[test]
    fn parses_generated_local_dev_contract_manifest() {
        let manifest = local_dev_contract_manifest().expect("generated manifest should parse");
        assert!(!manifest.network.is_empty());
        assert!(manifest.generated_at.ends_with('Z'));
        assert!(
            manifest
                .contracts
                .merchant_registry
                .as_deref()
                .is_some_and(|address| address.starts_with("0x"))
        );
        assert_eq!(
            manifest.billing.checkout_fee_bps(BillingPlan::Free),
            Some(50)
        );
        assert_eq!(
            manifest.billing.checkout_fee_bps(BillingPlan::Growth),
            Some(25)
        );
        assert_eq!(manifest.billing.plan_code(BillingPlan::Growth), Some(2));
    }

    #[test]
    fn resolves_contract_manifest_aliases() {
        let manifest = contract_manifest("localhost")
            .expect("generated manifest map should parse")
            .expect("localhost alias should resolve");

        assert_eq!(manifest.chain_id, Some(31337));
        assert_eq!(normalize_contract_environment("dev"), Some("local-dev"));
        assert_eq!(
            normalize_contract_environment("local_dev"),
            Some("local-dev")
        );
        assert_eq!(normalize_contract_environment("test"), Some("sepolia"));
        assert_eq!(normalize_contract_environment("testnet"), Some("sepolia"));
        assert_eq!(normalize_contract_environment("unknown"), None);
    }
}
