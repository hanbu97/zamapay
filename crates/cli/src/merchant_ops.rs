use anyhow::{Context, Result};
use shared::{ConfigureWebhookEndpointRequest, CreateProjectWithdrawalRequest, EvmFundingMethod};
use webhook_verifier::{sign_webhook_payload, verify_webhook_payload_result};

use crate::client::ApiClient;
use crate::common::{
    checkout_request, output, print_checkout, print_json, read_body, read_body_or_default,
    scoped_context,
};
use crate::config::{CliConfig, effective_api_url, require};
use crate::{
    AssetsArgs, BalanceArgs, CheckoutArgs, CheckoutCommand, CheckoutQuoteArgs, CheckoutShowArgs,
    CreateCheckoutArgs, DeliveryArgs, DeliveryCommand, EventArgs, EventCommand, TestWebhookArgs,
    VerifyWebhookArgs, WebhookArgs, WebhookCommand, WithdrawArgs,
};

pub async fn webhook(args: WebhookArgs) -> Result<()> {
    match args.command {
        WebhookCommand::List(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let overview = client.project_overview(&session, &project_id).await?;
            output(scope.control.json, &overview.webhook_endpoints, || {
                for endpoint in &overview.webhook_endpoints {
                    println!(
                        "{}  enabled={}  {}",
                        endpoint.endpoint_id, endpoint.enabled, endpoint.url
                    );
                }
                Ok(())
            })
        }
        WebhookCommand::Create(args) => {
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let response = client
                .create_webhook_endpoint(
                    &session,
                    &project_id,
                    &ConfigureWebhookEndpointRequest {
                        url: args.url,
                        environment: args.environment.map(crate::EnvArg::kind),
                        enabled: Some(true),
                    },
                )
                .await?;
            if args.scope.control.json {
                print_json(&response)?;
            } else if args.export_env {
                println!(
                    "export ZAMAPAY_WEBHOOK_ENDPOINT_ID='{}'",
                    response.endpoint.endpoint_id
                );
                if let Some(secret) = response.webhook_secret {
                    println!("export ZAMAPAY_WEBHOOK_SECRET='{secret}'");
                }
            } else {
                println!("endpoint_id: {}", response.endpoint.endpoint_id);
                println!("secret_preview: {}", response.endpoint.secret_preview);
                if let Some(secret) = response.webhook_secret {
                    println!("webhook_secret: {secret}");
                }
            }
            Ok(())
        }
        WebhookCommand::Update(args) => {
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let endpoint = client
                .update_webhook_endpoint(
                    &session,
                    &project_id,
                    &args.endpoint_id,
                    &ConfigureWebhookEndpointRequest {
                        url: args.url,
                        environment: args.environment.map(crate::EnvArg::kind),
                        enabled: Some(!args.disabled),
                    },
                )
                .await?;
            output(args.scope.control.json, &endpoint, || {
                println!("updated: {}", endpoint.endpoint_id);
                Ok(())
            })
        }
        WebhookCommand::Test(args) => {
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let deliveries = client
                .test_webhook_endpoint(&session, &project_id, &args.endpoint_id)
                .await?;
            output(args.scope.control.json, &deliveries, || {
                for delivery in &deliveries {
                    println!("{}  {:?}", delivery.delivery_id, delivery.status);
                }
                Ok(())
            })
        }
        WebhookCommand::RotateSecret(args) => {
            require(args.yes, "webhook secret rotation requires --yes")?;
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let response = client
                .rotate_webhook_secret(&session, &project_id, &args.endpoint_id)
                .await?;
            if args.scope.control.json {
                print_json(&response)?;
            } else if args.export_env {
                println!(
                    "export ZAMAPAY_WEBHOOK_ENDPOINT_ID='{}'",
                    response.endpoint.endpoint_id
                );
                println!(
                    "export ZAMAPAY_WEBHOOK_SECRET='{}'",
                    response.webhook_secret
                );
            } else {
                println!("endpoint_id: {}", response.endpoint.endpoint_id);
                println!("webhook_secret: {}", response.webhook_secret);
            }
            Ok(())
        }
    }
}

pub async fn checkout(args: CheckoutArgs) -> Result<()> {
    match args.command {
        CheckoutCommand::Create(args) => create_checkout(args).await,
        CheckoutCommand::List(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let overview = client.project_overview(&session, &project_id).await?;
            output(scope.control.json, &overview.checkout_sessions, || {
                for session in &overview.checkout_sessions {
                    println!(
                        "{}  {}  {:?}",
                        session.checkout_session_id,
                        session.payment_rail.as_str(),
                        session.status
                    );
                }
                Ok(())
            })
        }
        CheckoutCommand::Show(args) => checkout_show(args).await,
        CheckoutCommand::Quote(args) => checkout_quote(args).await,
    }
}

async fn checkout_show(args: CheckoutShowArgs) -> Result<()> {
    let (_, client, session, project_id) = scoped_context(&args.scope)?;
    let overview = client.project_overview(&session, &project_id).await?;
    let checkout = overview
        .checkout_sessions
        .into_iter()
        .find(|item| item.checkout_session_id == args.checkout_session_id)
        .context("checkout session not found")?;
    output(args.scope.control.json, &checkout, || {
        print_checkout(&checkout)
    })
}

async fn create_checkout(args: CreateCheckoutArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let client = ApiClient::new(&effective_api_url(args.api_url.as_deref(), &config))?;
    let project_id = match args.project_id.as_deref() {
        Some(project_id) => project_id.to_string(),
        None => client.bootstrap(&args.secret_key).await?.project_id,
    };
    let idempotency_key = args
        .idempotency_key
        .clone()
        .unwrap_or_else(|| args.merchant_order_id.clone());
    let request = checkout_request(&args)?;
    let response = client
        .create_checkout(&project_id, &args.secret_key, &idempotency_key, &request)
        .await?;
    output(args.json, &response, || {
        println!(
            "checkout_session_id: {}",
            response.session.checkout_session_id
        );
        println!("payment_rail: {}", response.session.payment_rail.as_str());
        println!("checkout_url: {}", response.session.checkout_url);
        if let Some(intent) = response.evm_payment_intent.as_ref() {
            println!("payment_intent_id: {}", intent.intent_id);
        }
        Ok(())
    })
}

async fn checkout_quote(args: CheckoutQuoteArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let client = ApiClient::new(&effective_api_url(args.api_url.as_deref(), &config))?;
    let project_id = match args.project_id.as_deref() {
        Some(project_id) => project_id.to_string(),
        None => client.bootstrap(&args.secret_key).await?.project_id,
    };
    let quote = client
        .checkout_quote(&project_id, &args.secret_key, args.amount_minor_units)
        .await?;
    output(args.json, &quote, || {
        println!(
            "gross_amount_minor_units: {}",
            quote.billing.gross_amount_minor_units
        );
        println!(
            "merchant_net_minor_units: {}",
            quote.billing.merchant_net_minor_units
        );
        println!(
            "platform_fee_minor_units: {}",
            quote.billing.platform_fee_minor_units
        );
        Ok(())
    })
}

pub async fn delivery(args: DeliveryArgs) -> Result<()> {
    match args.command {
        DeliveryCommand::List(scope) => {
            let (_, client, session, project_id) = scoped_context(&scope)?;
            let deliveries = client.list_deliveries(&session, &project_id).await?;
            output(scope.control.json, &deliveries, || {
                for delivery in &deliveries {
                    println!(
                        "{}  {:?}  attempts={}",
                        delivery.delivery_id, delivery.status, delivery.attempt_count
                    );
                }
                Ok(())
            })
        }
        DeliveryCommand::Resend(args) => {
            require(args.yes, "delivery resend requires --yes")?;
            let (_, client, session, project_id) = scoped_context(&args.scope)?;
            let deliveries = client
                .resend_delivery(&session, &project_id, &args.delivery_id)
                .await?;
            output(args.scope.control.json, &deliveries, || {
                for delivery in &deliveries {
                    println!("{}  {:?}", delivery.delivery_id, delivery.status);
                }
                Ok(())
            })
        }
    }
}

pub async fn event(args: EventArgs) -> Result<()> {
    let EventCommand::List(scope) = args.command;
    let (_, client, session, project_id) = scoped_context(&scope)?;
    let events = client.list_events(&session, &project_id).await?;
    output(scope.control.json, &events, || {
        for event in &events {
            println!(
                "{}  {}  {}",
                event.event_id, event.event_type, event.subject_id
            );
        }
        Ok(())
    })
}

pub async fn assets(args: AssetsArgs) -> Result<()> {
    let config = CliConfig::load()?;
    let client = ApiClient::new(&effective_api_url(args.api_url.as_deref(), &config))?;
    let assets = client.supported_assets().await?;
    output(args.json, &assets, || {
        for asset in &assets {
            println!(
                "{}  {}  {}  decimals={}  funding={}",
                asset.chain_id,
                asset.token_symbol,
                asset.token_contract,
                asset.token_decimals,
                asset
                    .funding_capabilities
                    .iter()
                    .map(|capability| funding_method_label(capability.method))
                    .collect::<Vec<_>>()
                    .join(",")
            );
        }
        Ok(())
    })
}

fn funding_method_label(method: EvmFundingMethod) -> &'static str {
    match method {
        EvmFundingMethod::Eip3009 => "eip3009",
        EvmFundingMethod::Permit2 => "permit2",
        EvmFundingMethod::Erc2612 => "erc2612",
        EvmFundingMethod::ApprovePay => "approve-pay",
    }
}

pub async fn balance(args: BalanceArgs) -> Result<()> {
    let (_, client, session, project_id) = scoped_context(&args.scope)?;
    let overview = client.project_overview(&session, &project_id).await?;
    output(
        args.scope.control.json,
        &overview.evm_asset_balances,
        || {
            println!(
                "withdrawable_minor_units: {}",
                overview.summary.withdrawable_minor_units
            );
            for asset in &overview.evm_asset_balances {
                println!(
                    "{}  {}  confirmed={}  withdrawable={}",
                    asset.chain_id,
                    asset.token_symbol,
                    asset.confirmed_minor_units,
                    asset.withdrawable_minor_units
                );
            }
            Ok(())
        },
    )
}

pub async fn withdraw(args: WithdrawArgs) -> Result<()> {
    require(args.yes, "withdraw requires --yes")?;
    let (_, client, session, project_id) = scoped_context(&args.scope)?;
    let overview = client
        .create_withdrawal(
            &session,
            &project_id,
            &CreateProjectWithdrawalRequest {
                amount_minor_units: args.amount_minor_units,
                chain_tx_hash: args.chain_tx_hash,
                chain_id: args.chain_id,
                token_contract: args.token_contract,
                settlement_contract: args.settlement_contract,
                recipient_address: args.recipient_address,
                settlement_bucket_commitment: None,
                withdrawal_nonce: None,
                withdraw_check_handle: None,
            },
        )
        .await?;
    output(args.scope.control.json, &overview.withdrawals, || {
        println!("withdrawals: {}", overview.withdrawals.len());
        Ok(())
    })
}

pub fn verify_webhook(args: VerifyWebhookArgs) -> Result<()> {
    let raw_body = read_body(args.body.as_deref(), args.body_file.as_ref())?;
    verify_webhook_payload_result(
        &args.secret,
        &args.svix_id,
        &args.svix_timestamp,
        &args.svix_signature,
        &raw_body,
        crate::common::now_unix_seconds()?,
    )
    .map_err(|error| anyhow::anyhow!("webhook verification failed: {error:?}"))?;
    output(
        args.json,
        &serde_json::json!({ "ok": true, "messageId": args.svix_id }),
        || {
            println!("webhook signature ok");
            Ok(())
        },
    )
}

pub async fn test_webhook(args: TestWebhookArgs) -> Result<()> {
    let raw_body = read_body_or_default(
        args.body.as_deref(),
        args.body_file.as_ref(),
        r#"{"type":"webhook.test","source":"zamapay-cli"}"#,
    )?;
    let timestamp = crate::common::now_unix_seconds()?;
    let message_id = args
        .message_id
        .unwrap_or_else(|| format!("msg_cli_{timestamp}"));
    let signature = sign_webhook_payload(&args.secret, &message_id, timestamp, &raw_body);
    let response = reqwest::Client::new()
        .post(&args.url)
        .header("content-type", "application/json")
        .header("svix-id", &message_id)
        .header("svix-timestamp", timestamp.to_string())
        .header("svix-signature", &signature)
        .body(raw_body)
        .send()
        .await
        .with_context(|| format!("failed to post signed webhook to {}", args.url))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    output(
        args.json,
        &serde_json::json!({
            "ok": (200..300).contains(&status),
            "status": status,
            "messageId": message_id,
            "body": body,
        }),
        || {
            println!("status: {status}");
            println!("message_id: {message_id}");
            if !body.trim().is_empty() {
                println!("body: {body}");
            }
            Ok(())
        },
    )?;
    require(
        (200..300).contains(&status),
        &format!("webhook receiver returned HTTP {status}"),
    )
}
