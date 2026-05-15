use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
use std::time::SystemTime;

use anyhow::{Context, Result, bail};
use serde::Serialize;
use shared::{CheckoutSession, CreateCheckoutSessionRequest, PaymentRail};

use crate::client::ApiClient;
use crate::config::{
    CliConfig, clean_api_url, control_session, effective_api_url, require, resolve_project_id,
};
use crate::{ControlArgs, CreateCheckoutArgs, ProjectScopedArgs};

pub(crate) fn control_context(args: &ControlArgs) -> Result<(CliConfig, ApiClient, String)> {
    let config = CliConfig::load()?;
    let api_url = effective_api_url(args.api_url.as_deref(), &config);
    let session = session_from_args(args.session_id.as_deref(), &config)?;
    Ok((config, ApiClient::new(&api_url)?, session))
}

pub(crate) fn scoped_context(
    args: &ProjectScopedArgs,
) -> Result<(CliConfig, ApiClient, String, String)> {
    let (config, client, session) = control_context(&args.control)?;
    let project_id = resolve_project_id(args.project_id.as_deref(), &config)?;
    Ok((config, client, session, project_id))
}

pub(crate) fn session_from_args(explicit: Option<&str>, config: &CliConfig) -> Result<String> {
    explicit
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .map(Ok)
        .unwrap_or_else(|| control_session(config))
}

pub(crate) fn read_private_key(private_key: Option<String>, stdin: bool) -> Result<String> {
    match (private_key, stdin) {
        (Some(_), true) => bail!("use only one of --private-key or --private-key-stdin"),
        (Some(value), false) => Ok(value),
        (None, true) => read_stdin("private key"),
        (None, false) => {
            bail!("provide --private-key, ZAMAPAY_OWNER_PRIVATE_KEY, or --private-key-stdin")
        }
    }
}

pub(crate) fn read_body(inline: Option<&str>, file: Option<&PathBuf>) -> Result<String> {
    match (inline, file) {
        (Some(_), Some(_)) => bail!("use only one of --body or --body-file"),
        (Some(body), None) => Ok(body.to_string()),
        (None, Some(path)) => fs::read_to_string(path)
            .with_context(|| format!("failed to read body file {}", path.display())),
        (None, None) => read_stdin("webhook body"),
    }
}

pub(crate) fn read_body_or_default(
    inline: Option<&str>,
    file: Option<&PathBuf>,
    default: &str,
) -> Result<String> {
    match (inline, file) {
        (None, None) => Ok(default.to_string()),
        _ => read_body(inline, file),
    }
}

pub(crate) fn read_stdin(label: &str) -> Result<String> {
    let mut value = String::new();
    io::stdin()
        .read_to_string(&mut value)
        .with_context(|| format!("failed to read {label} from stdin"))?;
    Ok(value.trim().to_string())
}

pub(crate) fn write_env_file(path: &PathBuf, body: &str, force: bool) -> Result<()> {
    if path.exists() && !force {
        bail!("{} exists; pass --force to overwrite", path.display());
    }
    fs::write(path, body).with_context(|| format!("failed to write {}", path.display()))
}

pub(crate) fn now_unix_seconds() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .context("system clock is before unix epoch")?
        .as_secs() as i64)
}

pub(crate) fn output<T: Serialize>(
    json: bool,
    value: &T,
    human: impl FnOnce() -> Result<()>,
) -> Result<()> {
    if json { print_json(value) } else { human() }
}

pub(crate) fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

pub(crate) fn print_project_overview(overview: &shared::ProjectDashboardOverview) -> Result<()> {
    println!("project_id: {}", overview.project.project_id);
    println!("name: {}", overview.project.name);
    println!("owner_wallet: {}", overview.project.owner_wallet);
    println!("checkout_sessions: {}", overview.checkout_sessions.len());
    println!("webhook_endpoints: {}", overview.webhook_endpoints.len());
    println!(
        "withdrawable_minor_units: {}",
        overview.summary.withdrawable_minor_units
    );
    Ok(())
}

pub(crate) fn print_checkout(checkout: &CheckoutSession) -> Result<()> {
    println!("checkout_session_id: {}", checkout.checkout_session_id);
    println!("payment_rail: {}", checkout.payment_rail.as_str());
    println!("status: {:?}", checkout.status);
    println!("checkout_url: {}", checkout.checkout_url);
    Ok(())
}

pub(crate) fn present(value: bool) -> &'static str {
    if value { "present" } else { "missing" }
}

pub(crate) fn checkout_request(args: &CreateCheckoutArgs) -> Result<CreateCheckoutSessionRequest> {
    let payment_rail = args.payment_rail.payment_rail();
    match payment_rail {
        PaymentRail::EvmErc20 => {
            require(
                args.evm_chain_id.is_some(),
                "evm_erc20 requires --evm-chain-id",
            )?;
            require(
                args.evm_token_symbol
                    .as_ref()
                    .is_some_and(|s| !s.trim().is_empty()),
                "evm_erc20 requires --evm-token-symbol",
            )?;
            require(
                args.chain_invoice_id.is_none() && args.chain_tx_hash.is_none(),
                "evm_erc20 must not include private rail chain invoice fields",
            )?;
        }
        PaymentRail::ZamaPrivate => {
            require(
                args.chain_invoice_id.is_some(),
                "zama_private requires --chain-invoice-id",
            )?;
            require(
                args.chain_tx_hash
                    .as_ref()
                    .is_some_and(|h| !h.trim().is_empty()),
                "zama_private requires --chain-tx-hash",
            )?;
            require(
                args.evm_chain_id.is_none() && args.evm_token_symbol.is_none(),
                "zama_private must not include EVM rail fields",
            )?;
        }
    }
    Ok(CreateCheckoutSessionRequest {
        merchant_order_id: args.merchant_order_id.clone(),
        title: args.title.clone(),
        amount_label: args.amount_label.clone(),
        amount_minor_units: args.amount_minor_units,
        note: args.note.clone(),
        success_url: args.success_url.clone(),
        cancel_url: args.cancel_url.clone(),
        payment_rail: Some(payment_rail),
        evm_chain_id: args.evm_chain_id,
        evm_token_symbol: args.evm_token_symbol.clone(),
        chain_invoice_id: args.chain_invoice_id,
        chain_tx_hash: args.chain_tx_hash.clone(),
        metadata: parse_metadata(&args.metadata)?,
    })
}

pub fn init_env_bundle(api_url: &str, secret_key: Option<&str>) -> String {
    format!(
        "export ZAMAPAY_API_URL='{}'\nexport ZAMAPAY_SECRET_KEY='{}'\n",
        clean_api_url(api_url),
        secret_key.unwrap_or("<zms_test_or_live_project_secret>")
    )
}

pub fn parse_metadata(values: &[String]) -> Result<BTreeMap<String, String>> {
    let mut metadata = BTreeMap::new();
    for value in values {
        let Some((key, item)) = value.split_once('=') else {
            bail!("metadata must use key=value syntax: {value}");
        };
        let key = key.trim();
        require(!key.is_empty(), "metadata key cannot be empty")?;
        metadata.insert(key.to_string(), item.trim().to_string());
    }
    Ok(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose};
    use webhook_verifier::{sign_webhook_payload, verify_webhook_payload_result};

    fn checkout_args(payment_rail: crate::RailArg) -> CreateCheckoutArgs {
        CreateCheckoutArgs {
            api_url: None,
            secret_key: "zms_test_fixture".to_string(),
            project_id: Some("proj_fixture".to_string()),
            payment_rail,
            merchant_order_id: "order_fixture".to_string(),
            title: "Fixture order".to_string(),
            amount_label: "10 USDT".to_string(),
            amount_minor_units: 10_000_000,
            note: String::new(),
            success_url: None,
            cancel_url: None,
            evm_chain_id: None,
            evm_token_symbol: None,
            chain_invoice_id: None,
            chain_tx_hash: None,
            metadata: vec![],
            idempotency_key: None,
            json: false,
        }
    }

    #[test]
    fn init_bundle_uses_single_project_secret() {
        let bundle = init_env_bundle("http://127.0.0.1:18080/", Some("zms_test_123"));
        assert!(bundle.contains("ZAMAPAY_API_URL='http://127.0.0.1:18080'"));
        assert!(bundle.contains("ZAMAPAY_SECRET_KEY='zms_test_123'"));
        assert!(!bundle.contains("ZAMAPAY_PROJECT_ID"));
        assert!(!bundle.contains("ZAMAPAY_WEBHOOK_SECRET"));
    }

    #[test]
    fn metadata_requires_key_value_pairs() {
        let metadata =
            parse_metadata(&["cart=abc".to_string(), "customer = alice ".to_string()]).unwrap();
        assert_eq!(metadata.get("cart").map(String::as_str), Some("abc"));
        assert_eq!(metadata.get("customer").map(String::as_str), Some("alice"));
        assert!(parse_metadata(&["not-pair".to_string()]).is_err());
    }

    #[test]
    fn checkout_request_requires_explicit_evm_fields() {
        let mut args = checkout_args(crate::RailArg::EvmErc20);
        assert!(checkout_request(&args).is_err());
        args.evm_chain_id = Some(31337);
        args.evm_token_symbol = Some("USDT".to_string());
        let request = checkout_request(&args).unwrap();
        assert_eq!(request.payment_rail, Some(PaymentRail::EvmErc20));
        assert_eq!(request.evm_chain_id, Some(31337));
    }

    #[test]
    fn checkout_request_rejects_cross_rail_fields() {
        let mut args = checkout_args(crate::RailArg::EvmErc20);
        args.evm_chain_id = Some(31337);
        args.evm_token_symbol = Some("USDT".to_string());
        args.chain_invoice_id = Some(7);
        assert!(checkout_request(&args).is_err());
    }

    #[test]
    fn webhook_verification_uses_raw_body() {
        let secret = format!(
            "whsec_{}",
            general_purpose::STANDARD_NO_PAD.encode("current-webhook-secret")
        );
        let raw = r#"{"type":"webhook.test","amount":100}"#;
        let tampered = r#"{ "type": "webhook.test", "amount": 100 }"#;
        let timestamp = 1_778_760_000;
        let signature = sign_webhook_payload(&secret, "msg_cli_test", timestamp, raw);
        assert!(
            verify_webhook_payload_result(
                &secret,
                "msg_cli_test",
                &timestamp.to_string(),
                &signature,
                raw,
                timestamp
            )
            .is_ok()
        );
        assert!(
            verify_webhook_payload_result(
                &secret,
                "msg_cli_test",
                &timestamp.to_string(),
                &signature,
                tampered,
                timestamp
            )
            .is_err()
        );
    }
}
