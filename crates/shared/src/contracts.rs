use std::collections::HashMap;

use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractAddresses {
    #[serde(rename = "MerchantRegistry")]
    pub merchant_registry: Option<String>,
    #[serde(rename = "ConfidentialUSDMock")]
    pub confidential_usd_mock: Option<String>,
    #[serde(rename = "ConfidentialInvoiceSettlement")]
    pub confidential_invoice_settlement: Option<String>,
}

pub fn local_dev_contract_manifest() -> Result<AddressManifest, serde_json::Error> {
    serde_json::from_str(generated_contracts::LOCAL_DEV_MANIFEST_JSON)
}

pub fn contract_manifest(environment: &str) -> Result<Option<AddressManifest>, serde_json::Error> {
    let manifests: HashMap<String, AddressManifest> =
        serde_json::from_str(generated_contracts::ADDRESS_MANIFESTS_JSON)?;
    let normalized = match environment {
        "hardhat" | "localhost" | "local" => "local-dev",
        other => other,
    };

    Ok(manifests.get(normalized).cloned())
}

#[cfg(test)]
mod tests {
    use super::{contract_manifest, local_dev_contract_manifest};

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
    }

    #[test]
    fn resolves_contract_manifest_aliases() {
        let manifest = contract_manifest("localhost")
            .expect("generated manifest map should parse")
            .expect("localhost alias should resolve");

        assert_eq!(manifest.chain_id, Some(31337));
    }
}
