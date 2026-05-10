use std::{env, net::SocketAddr};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8092";
const DEFAULT_API_URL: &str = "http://127.0.0.1:8080";
const DEFAULT_CHAIN_INVOICE_API_URL: &str = "http://127.0.0.1:3001";
const DEFAULT_CONSOLE_URL: &str = "http://127.0.0.1:3001/merchant";
const DEFAULT_LOGIN_URL: &str = "http://127.0.0.1:3001/login";
const DEFAULT_MERCHANT_LABEL: &str = "CardForge Demo Store";
const DEFAULT_STORE_KEY: &str = "local-dev";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://127.0.0.1:8092/api/mermer-pay/webhook";

#[derive(Clone)]
pub(crate) struct Config {
    pub(crate) bind_addr: SocketAddr,
    pub(crate) database_url: String,
    pub(crate) local_chain_invoice_api_url: String,
    pub(crate) login_url: String,
    pub(crate) mermer_api_url: String,
    pub(crate) mermer_console_url: String,
    pub(crate) project_api_key: String,
    pub(crate) merchant_label: String,
    pub(crate) project_id: String,
    pub(crate) store_key: String,
    pub(crate) webhook_endpoint: String,
    pub(crate) webhook_secret: String,
}

impl Config {
    pub(crate) fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let mermer_console_url =
            clean_base_url(env_value("MERMER_PAY_CONSOLE_URL", DEFAULT_CONSOLE_URL));
        Ok(Self {
            bind_addr: env_value("CARDFORGE_BACKEND_BIND", DEFAULT_BIND_ADDR).parse()?,
            database_url: required_env("CARDFORGE_DATABASE_URL")?,
            login_url: env_value("MERMER_PAY_LOGIN_URL", DEFAULT_LOGIN_URL),
            local_chain_invoice_api_url: clean_base_url(env_value(
                "MERMER_PAY_CHAIN_INVOICE_API_URL",
                DEFAULT_CHAIN_INVOICE_API_URL,
            )),
            mermer_api_url: clean_base_url(env_value("MERMER_PAY_API_URL", DEFAULT_API_URL)),
            mermer_console_url,
            project_api_key: required_env("MERMER_PAY_API_KEY")?,
            merchant_label: env_value("CARDFORGE_MERCHANT_LABEL", DEFAULT_MERCHANT_LABEL),
            project_id: required_env("MERMER_PAY_PROJECT_ID")?,
            store_key: env_value("CARDFORGE_STORE_KEY", DEFAULT_STORE_KEY),
            webhook_endpoint: env_value("CARDFORGE_WEBHOOK_ENDPOINT", DEFAULT_WEBHOOK_ENDPOINT),
            webhook_secret: required_env("MERMER_PAY_WEBHOOK_SECRET")?,
        })
    }
}

fn env_value(key: &str, fallback: &str) -> String {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn required_env(key: &'static str) -> Result<String, ConfigError> {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(ConfigError(key))
}

fn clean_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

#[derive(Debug)]
struct ConfigError(&'static str);

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "required CardForge environment variable {} is missing",
            self.0
        )
    }
}

impl std::error::Error for ConfigError {}
