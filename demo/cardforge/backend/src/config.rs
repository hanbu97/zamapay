use std::{env, net::SocketAddr};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8092";
const DEFAULT_API_URL: &str = "http://127.0.0.1:8080";
const DEFAULT_CHAIN_INVOICE_API_URL: &str = "http://127.0.0.1:3001";
const DEFAULT_CONSOLE_URL: &str = "http://127.0.0.1:3001/merchant";
const DEFAULT_LOGIN_URL: &str = "http://127.0.0.1:3001/login";
const DEFAULT_MERCHANT_LABEL: &str = "CardForge Demo Store";
const DEFAULT_STORE_KEY: &str = "local-dev";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://127.0.0.1:8092/api/zamapay/webhook";

#[derive(Clone)]
pub(crate) struct Config {
    pub(crate) allowed_origins: Vec<String>,
    pub(crate) bind_addr: SocketAddr,
    pub(crate) database_url: String,
    pub(crate) local_chain_invoice_api_url: String,
    pub(crate) login_url: String,
    pub(crate) zamapay_api_url: String,
    pub(crate) zamapay_console_url: String,
    pub(crate) project_api_key: String,
    pub(crate) merchant_label: String,
    pub(crate) project_id: String,
    pub(crate) store_key: String,
    pub(crate) webhook_endpoint: String,
    pub(crate) webhook_secret: String,
}

impl Config {
    pub(crate) fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let zamapay_console_url =
            clean_base_url(env_value("ZAMAPAY_CONSOLE_URL", DEFAULT_CONSOLE_URL));
        Ok(Self {
            allowed_origins: list_env("CARDFORGE_ALLOWED_ORIGINS"),
            bind_addr: bind_addr()?,
            database_url: required_env("CARDFORGE_DATABASE_URL")?,
            login_url: env_value("ZAMAPAY_LOGIN_URL", DEFAULT_LOGIN_URL),
            local_chain_invoice_api_url: clean_base_url(env_value(
                "ZAMAPAY_CHAIN_INVOICE_API_URL",
                DEFAULT_CHAIN_INVOICE_API_URL,
            )),
            zamapay_api_url: clean_base_url(env_value("ZAMAPAY_API_URL", DEFAULT_API_URL)),
            zamapay_console_url,
            project_api_key: required_env("ZAMAPAY_API_KEY")?,
            merchant_label: env_value("CARDFORGE_MERCHANT_LABEL", DEFAULT_MERCHANT_LABEL),
            project_id: required_env("ZAMAPAY_PROJECT_ID")?,
            store_key: env_value("CARDFORGE_STORE_KEY", DEFAULT_STORE_KEY),
            webhook_endpoint: env_value("CARDFORGE_WEBHOOK_ENDPOINT", DEFAULT_WEBHOOK_ENDPOINT),
            webhook_secret: required_env("ZAMAPAY_WEBHOOK_SECRET")?,
        })
    }
}

fn bind_addr() -> Result<SocketAddr, Box<dyn std::error::Error>> {
    if let Ok(value) = env::var("CARDFORGE_BACKEND_BIND")
        && !value.trim().is_empty()
    {
        return Ok(value.parse()?);
    }

    if let Ok(port) = env::var("PORT")
        && !port.trim().is_empty()
    {
        return Ok(format!("0.0.0.0:{}", port.trim()).parse()?);
    }

    Ok(DEFAULT_BIND_ADDR.parse()?)
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

fn list_env(key: &str) -> Vec<String> {
    env::var(key)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(clean_base_url_ref)
        .collect()
}

fn clean_base_url(value: String) -> String {
    value.trim_end_matches('/').to_string()
}

fn clean_base_url_ref(value: &str) -> String {
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
