use std::{collections::HashMap, env, sync::OnceLock};

use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProfile {
    checkout_base_env: Vec<String>,
    contract_environment: String,
    default_checkout_base_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeProfileContract {
    default_profile: String,
    profiles: HashMap<String, RuntimeProfile>,
}

static CONTRACT: OnceLock<RuntimeProfileContract> = OnceLock::new();

pub(crate) fn active_contract_environment() -> String {
    active_runtime_profile().contract_environment
}

pub(crate) fn checkout_base_url() -> String {
    let profile = active_runtime_profile();
    env_value(&profile.checkout_base_env)
        .or(profile.default_checkout_base_url)
        .expect("active runtime profile must define checkout base URL")
}

fn active_runtime_profile() -> RuntimeProfile {
    let contract = runtime_profile_contract();
    let raw = env::var("ZAMAPAY_RUNTIME_PROFILE")
        .or_else(|_| env::var("NEXT_PUBLIC_RUNTIME_PROFILE"))
        .unwrap_or_else(|_| contract.default_profile.clone());
    let key = clean_key(&raw);

    contract
        .profiles
        .get(&key)
        .unwrap_or_else(|| panic!("unsupported runtime profile: {raw}"))
        .clone()
}

fn runtime_profile_contract() -> &'static RuntimeProfileContract {
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../../../env/runtime-profiles.json"))
            .expect("env/runtime-profiles.json must be valid")
    })
}

fn env_value(names: &[String]) -> Option<String> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn clean_key(value: &str) -> String {
    value.trim().to_lowercase()
}
