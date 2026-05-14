use std::{env, net::SocketAddr};

use serde::Deserialize;

use crate::types::{LOCAL_CHAIN_ID, PaymentRail};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8092";
const DEFAULT_API_URL: &str = "http://127.0.0.1:18080";
const DEFAULT_CHAIN_INVOICE_API_URL: &str = "http://127.0.0.1:3001";
const DEFAULT_CONSOLE_URL: &str = "http://127.0.0.1:3001/merchant";
const DEFAULT_LOGIN_URL: &str = "http://127.0.0.1:3001/login";
const DEFAULT_MERCHANT_LABEL: &str = "CardForge Demo Store";
const DEFAULT_STORE_KEY: &str = "local-dev";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://127.0.0.1:8092/api/zamapay/webhook";
const DEFAULT_EVM_TOKEN_SYMBOL: &str = "USDT";

#[derive(Clone)]
pub(crate) struct Config {
    pub(crate) allowed_origins: Vec<String>,
    pub(crate) bind_addr: SocketAddr,
    pub(crate) database_url: String,
    pub(crate) local_chain_invoice_api_url: String,
    pub(crate) login_url: String,
    pub(crate) zamapay_api_url: String,
    pub(crate) zamapay_console_url: String,
    pub(crate) project_secret_key: String,
    pub(crate) merchant_label: String,
    pub(crate) project_id: String,
    pub(crate) store_key: String,
    pub(crate) webhook_endpoint: String,
    pub(crate) webhook_endpoint_id: String,
    pub(crate) webhook_secret: String,
    pub(crate) payment_rail: PaymentRail,
    pub(crate) evm_chain_id: u64,
    pub(crate) evm_token_symbol: String,
}

impl Config {
    pub(crate) async fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let zamapay_api_url = clean_base_url(env_value("ZAMAPAY_API_URL", DEFAULT_API_URL));
        let zamapay_console_url =
            clean_base_url(env_value("ZAMAPAY_CONSOLE_URL", DEFAULT_CONSOLE_URL));
        let secret_key = required_env("ZAMAPAY_SECRET_KEY")?;
        let credentials = project_credentials(&zamapay_api_url, &secret_key).await?;
        Ok(Self {
            allowed_origins: list_env("CARDFORGE_ALLOWED_ORIGINS"),
            bind_addr: bind_addr()?,
            database_url: required_env("CARDFORGE_DATABASE_URL")?,
            login_url: env_value("ZAMAPAY_LOGIN_URL", DEFAULT_LOGIN_URL),
            local_chain_invoice_api_url: clean_base_url(env_value(
                "ZAMAPAY_CHAIN_INVOICE_API_URL",
                DEFAULT_CHAIN_INVOICE_API_URL,
            )),
            zamapay_api_url,
            zamapay_console_url,
            project_secret_key: credentials.secret_key,
            merchant_label: env_value("CARDFORGE_MERCHANT_LABEL", DEFAULT_MERCHANT_LABEL),
            project_id: credentials.project_id,
            store_key: env_value("CARDFORGE_STORE_KEY", DEFAULT_STORE_KEY),
            webhook_endpoint: env_value("CARDFORGE_WEBHOOK_ENDPOINT", DEFAULT_WEBHOOK_ENDPOINT),
            webhook_endpoint_id: credentials.webhook_endpoint_id,
            webhook_secret: credentials.webhook_secret,
            payment_rail: payment_rail()?,
            evm_chain_id: env_u64("CARDFORGE_EVM_CHAIN_ID", LOCAL_CHAIN_ID)?,
            evm_token_symbol: env_value("CARDFORGE_EVM_TOKEN_SYMBOL", DEFAULT_EVM_TOKEN_SYMBOL),
        })
    }
}

#[derive(Debug)]
struct ProjectCredentials {
    secret_key: String,
    project_id: String,
    webhook_endpoint_id: String,
    webhook_secret: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSecretBootstrapResponse {
    project_id: String,
    webhook_endpoint_id: Option<String>,
    webhook_secret: Option<String>,
}

async fn project_credentials(
    api_url: &str,
    secret_key: &str,
) -> Result<ProjectCredentials, Box<dyn std::error::Error>> {
    let bootstrap = reqwest::Client::new()
        .get(format!("{api_url}/api/project-secret/bootstrap"))
        .bearer_auth(secret_key)
        .send()
        .await
        .map_err(BootstrapError::transport)?;

    let status = bootstrap.status();
    if !status.is_success() {
        return Err(Box::new(BootstrapError(format!(
            "ZamaPay project secret bootstrap failed with HTTP {status}"
        ))));
    }

    let bootstrap = bootstrap
        .json::<ProjectSecretBootstrapResponse>()
        .await
        .map_err(BootstrapError::decode)?;
    let project_id = if bootstrap.project_id.trim().is_empty() {
        return Err(Box::new(BootstrapError(
            "ZamaPay project secret bootstrap did not return project id".into(),
        )));
    } else {
        bootstrap.project_id
    };
    let webhook_endpoint_id = bootstrap
        .webhook_endpoint_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| BootstrapError("ZamaPay project has no enabled webhook endpoint".into()))?;
    let webhook_secret = bootstrap
        .webhook_secret
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| BootstrapError("ZamaPay project webhook secret is unavailable".into()))?;

    Ok(ProjectCredentials {
        secret_key: secret_key.to_string(),
        project_id,
        webhook_endpoint_id,
        webhook_secret,
    })
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

fn payment_rail() -> Result<PaymentRail, Box<dyn std::error::Error>> {
    let raw = env_value("CARDFORGE_PAYMENT_RAIL", "zama_private");
    PaymentRail::from_env(&raw).ok_or_else(|| {
        Box::new(ConfigMessage(format!(
            "CARDFORGE_PAYMENT_RAIL must be zama_private or evm_erc20, got {raw}"
        ))) as Box<dyn std::error::Error>
    })
}

fn env_u64(key: &str, fallback: u64) -> Result<u64, Box<dyn std::error::Error>> {
    let Some(raw) = env::var(key).ok().filter(|value| !value.trim().is_empty()) else {
        return Ok(fallback);
    };
    raw.trim().parse::<u64>().map_err(|error| {
        Box::new(ConfigMessage(format!(
            "{key} must be an unsigned integer: {error}"
        ))) as Box<dyn std::error::Error>
    })
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

#[derive(Debug)]
struct BootstrapError(String);

impl BootstrapError {
    fn transport(error: reqwest::Error) -> Self {
        Self(format!(
            "ZamaPay project secret bootstrap request failed: {error}"
        ))
    }

    fn decode(error: reqwest::Error) -> Self {
        Self(format!(
            "ZamaPay project secret bootstrap returned invalid JSON: {error}"
        ))
    }
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for BootstrapError {}

#[derive(Debug)]
struct ConfigMessage(String);

impl std::fmt::Display for ConfigMessage {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConfigMessage {}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{Json, Router, http::HeaderMap, routing::get};
    use serde_json::json;
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn bootstraps_project_credentials_with_secret_key() {
        let captured = Arc::new(Mutex::new(None::<String>));
        let api = fake_bootstrap_api(
            captured.clone(),
            json!({
                "projectId": "proj_1",
                "environment": "local_dev",
                "webhookEndpointId": "we_1",
                "webhookEndpointUrl": "http://127.0.0.1:8092/api/zamapay/webhook",
                "webhookSecret": "whsec_dGVzdA"
            }),
        )
        .await;

        let credentials = project_credentials(&api, "zms_test_1").await.unwrap();

        assert_eq!(credentials.secret_key, "zms_test_1");
        assert_eq!(credentials.project_id, "proj_1");
        assert_eq!(credentials.webhook_endpoint_id, "we_1");
        assert_eq!(credentials.webhook_secret, "whsec_dGVzdA");
        assert_eq!(
            captured.lock().unwrap().as_deref(),
            Some("Bearer zms_test_1")
        );
    }

    #[tokio::test]
    async fn rejects_bootstrap_without_enabled_webhook() {
        let api = fake_bootstrap_api(
            Arc::new(Mutex::new(None)),
            json!({
                "projectId": "proj_1",
                "environment": "local_dev",
                "webhookEndpointId": null,
                "webhookEndpointUrl": null,
                "webhookSecret": null
            }),
        )
        .await;

        let error = project_credentials(&api, "zms_test_1").await.unwrap_err();

        assert!(error.to_string().contains("no enabled webhook endpoint"));
    }

    async fn fake_bootstrap_api(
        captured: Arc<Mutex<Option<String>>>,
        body: serde_json::Value,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/api/project-secret/bootstrap",
            get(move |headers: HeaderMap| {
                let captured = captured.clone();
                let body = body.clone();
                async move {
                    *captured.lock().unwrap() = headers
                        .get("authorization")
                        .and_then(|value| value.to_str().ok())
                        .map(ToOwned::to_owned);
                    Json(body)
                }
            }),
        );

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        format!("http://{addr}")
    }
}
