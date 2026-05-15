use std::{str::FromStr, sync::Arc};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::CookieJar;
use chrono::Utc;
use domain::ensure_not_expired;
use ethers_core::abi::{Token, encode};
use ethers_core::types::{Address, H256, Signature, U256};
use ethers_core::utils::{hash_message, keccak256};
use fulfillment::{FulfillmentDecision, decide};
use indexer::ProjectionState;
use shared::{
    AddressManifest, CreateInvoiceRequest, DEFAULT_FINALITY_THRESHOLD, DashboardOverview,
    DecryptCallbackRequest, EvmFundingAction, EvmFundingAuthorization, EvmFundingCapability,
    EvmFundingMethod, EvmIndexerCursor, EvmIndexerCursorProjectionRequest, EvmIndexerWatchlist,
    EvmPaymentActionsRequest, EvmPaymentActionsResponse, EvmPaymentIntent, EvmPaymentIntentStatus,
    EvmSettlementEventProjectionRequest, EvmSettlementEventProjectionResponse, FulfillmentResponse,
    InvoiceRecord, NonceRequest, NonceResponse, OperatorDiagnostics,
    OperatorSettlementEventRequest, PaymentConfirmationsRequest, PaymentProjectionRequest,
    PublicCheckoutResponse, SessionResponse, SupportedEvmAsset, VerifyRequest,
    WebhookDeliveryRequest, contract_manifest,
};
use storage::{AuthStore, DecryptRequestProjection, PortalStore, StoredSession};
use tokio::sync::RwLock;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

mod billing;
mod http_policy;
mod projects;
mod runtime_profile;

const SESSION_COOKIE_NAME: &str = "zamapay_session";
const OPERATOR_KEY_HEADER: &str = "x-operator-key";
const GATEWAY_KEY_HEADER: &str = "x-zama-gateway-key";
const DEFAULT_OPERATOR_KEY: &str = "local-operator-dev-key";
const DEFAULT_GATEWAY_CALLBACK_KEY: &str = "local-zama-gateway-dev-key";
const DEFAULT_WEBHOOK_MAX_ATTEMPTS: u32 = 3;
const EVM_PAYMENT_AUTHORIZATION_TYPE: &str = "ZamaPayEvmPayment(bytes32 intentId,bytes32 projectId,address payer,address token,uint256 grossAmount,uint256 merchantNetAmount,uint256 platformFeeAmount,address settlement,uint256 chainId,uint256 deadline)";
const PERMIT2_PAYMENT_WITNESS_TYPE_STRING: &str = "ZamaPayEvmPayment witness)TokenPermissions(address token,uint256 amount)ZamaPayEvmPayment(bytes32 intentId,bytes32 projectId,address payer,address token,uint256 grossAmount,uint256 merchantNetAmount,uint256 platformFeeAmount,address settlement,uint256 chainId,uint256 deadline)";

#[derive(Clone)]
pub struct AppState {
    store: AuthStore,
    portal: PortalStore,
    webhook_client: reqwest::Client,
    operator_auth_rejections: Arc<RwLock<u32>>,
}

impl AppState {
    pub async fn new() -> Self {
        Self::with_portal(PortalStore::from_env().await)
    }

    pub fn with_portal(portal: PortalStore) -> Self {
        Self {
            store: AuthStore::default(),
            portal,
            webhook_client: reqwest::Client::new(),
            operator_auth_rejections: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn issue_dev_session(&self, address: &str) -> shared::SessionUser {
        self.store.create_session(address, Utc::now()).await.user
    }

    async fn operator_auth_rejections(&self) -> u32 {
        *self.operator_auth_rejections.read().await
    }

    async fn record_operator_auth_rejection(&self) {
        *self.operator_auth_rejections.write().await += 1;
    }
}

pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/auth/nonce", post(issue_nonce))
        .route("/api/auth/verify", post(verify_signature))
        .route("/api/session", get(current_session).delete(delete_session))
        .merge(billing::routes())
        .merge(projects::routes())
        .route(
            "/api/contracts/{environment}",
            get(contract_environment_manifest),
        )
        .route("/api/supported-assets", get(supported_assets))
        .route("/api/checkout/{checkout_id}", get(public_checkout))
        .route(
            "/api/checkout/{checkout_id}/evm-payment-actions",
            post(evm_payment_actions),
        )
        .route("/api/dashboard/overview", get(dashboard_overview))
        .route("/api/invoices", post(create_invoice))
        .route(
            "/api/invoices/{invoice_id}/fulfillment",
            get(invoice_fulfillment),
        )
        .route(
            "/api/invoices/{invoice_id}/decrypt-request",
            post(request_invoice_decrypt),
        )
        .route("/api/invoices/{invoice_id}", get(invoice_detail))
        .route("/api/operator/diagnostics", get(operator_diagnostics))
        .route("/api/operator/evm/watchlist", get(evm_indexer_watchlist))
        .route(
            "/api/operator/evm/settlement-events",
            post(project_evm_settlement_event),
        )
        .route(
            "/api/operator/evm/cursors",
            post(project_evm_indexer_cursor),
        )
        .route(
            "/api/operator/invoices/{invoice_id}/payment-projection",
            post(project_invoice_payment),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/payment-projection",
            post(project_chain_invoice_payment),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/confirmations",
            post(project_chain_invoice_confirmations),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/settlement-event",
            post(project_chain_invoice_settlement_event),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/webhook-delivery",
            post(project_chain_invoice_webhook_delivery),
        )
        .route(
            "/api/operator/chain-invoices/{chain_invoice_id}/webhook-dispatch",
            get(chain_invoice_webhook_dispatch),
        )
        .route(
            "/api/operator/decrypt-requests/{request_id}/callback",
            post(project_decrypt_callback),
        )
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(http_policy::cors_layer())
}

async fn health() -> &'static str {
    "ok"
}

async fn issue_nonce(
    State(state): State<AppState>,
    Json(payload): Json<NonceRequest>,
) -> Result<Json<NonceResponse>, ApiError> {
    let now = Utc::now();
    let address = normalize_address(&payload.address)?;
    let challenge = state.store.issue_challenge(&address, now).await;

    Ok(Json(NonceResponse {
        nonce: challenge.nonce,
        message: challenge.message,
        expires_at: challenge.expires_at,
    }))
}

async fn verify_signature(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<VerifyRequest>,
) -> Result<(CookieJar, Json<SessionResponse>), ApiError> {
    let now = Utc::now();
    let address = normalize_address(&payload.address)?;
    let challenge = state
        .store
        .find_challenge(&address)
        .await
        .ok_or(ApiError::unauthorized("unknown auth challenge"))?;

    if challenge.consumed {
        return Err(ApiError::unauthorized("auth challenge already consumed"));
    }

    if challenge.nonce != payload.nonce || challenge.message != payload.message {
        return Err(ApiError::unauthorized("auth challenge mismatch"));
    }

    ensure_not_expired(challenge.issued_at, now)
        .map_err(|_| ApiError::unauthorized("auth challenge expired"))?;
    recover_and_compare_address(&payload.message, &payload.signature, &address)?;

    state.store.consume_challenge(&address).await;
    let session = state.store.create_session(&address, now).await;
    let cookie =
        http_policy::session_cookie(SESSION_COOKIE_NAME, session.user.session_id.to_string());

    Ok((
        jar.add(cookie),
        Json(SessionResponse {
            authenticated: true,
            user: Some(session.user),
        }),
    ))
}

async fn current_session(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<SessionResponse>, ApiError> {
    let Some(session) = session_from_cookie(&state, &jar).await? else {
        return Ok(Json(SessionResponse {
            authenticated: false,
            user: None,
        }));
    };

    Ok(Json(SessionResponse {
        authenticated: true,
        user: Some(session.user),
    }))
}

async fn delete_session(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), ApiError> {
    if let Some(session_id) = session_id_from_cookie_lossy(&jar) {
        state.store.delete_session(&session_id).await;
    }

    let cookie = http_policy::expired_session_cookie(SESSION_COOKIE_NAME);
    Ok((jar.remove(cookie), StatusCode::NO_CONTENT))
}

async fn dashboard_overview(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<Json<DashboardOverview>, ApiError> {
    let session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;
    Ok(Json(
        state.portal.dashboard_overview(&session.user.address).await,
    ))
}

async fn contract_environment_manifest(
    Path(environment): Path<String>,
) -> Result<Json<AddressManifest>, ApiError> {
    let manifest = contract_manifest(&environment)
        .map_err(|_| ApiError::internal("generated contract manifest is invalid"))?
        .ok_or_else(|| {
            ApiError::not_found("contract manifest is not available for this environment")
        })?;
    Ok(Json(manifest))
}

async fn supported_assets(
    State(state): State<AppState>,
) -> Result<Json<Vec<SupportedEvmAsset>>, ApiError> {
    Ok(Json(state.portal.supported_evm_assets().await))
}

async fn public_checkout(
    State(state): State<AppState>,
    Path(checkout_id): Path<String>,
) -> Result<Json<PublicCheckoutResponse>, ApiError> {
    state
        .portal
        .public_checkout_by_id(&checkout_id)
        .await
        .map(Json)
        .ok_or(ApiError::not_found("checkout not found"))
}

async fn evm_payment_actions(
    State(state): State<AppState>,
    Path(checkout_id): Path<String>,
    Json(payload): Json<EvmPaymentActionsRequest>,
) -> Result<Json<EvmPaymentActionsResponse>, ApiError> {
    validate_evm_address("payerAddress", &payload.payer_address)?;
    let checkout = state
        .portal
        .public_checkout_by_id(&checkout_id)
        .await
        .ok_or(ApiError::not_found("checkout not found"))?;
    let intent = checkout
        .evm_payment_intent
        .as_ref()
        .ok_or(ApiError::bad_request(
            "checkout is not an evm_erc20 payment",
        ))?;
    let asset = checkout
        .evm_asset
        .as_ref()
        .ok_or(ApiError::bad_request("checkout has no supported EVM asset"))?;

    let mut capabilities = asset.funding_capabilities.clone();
    capabilities.sort_by_key(|capability| capability.rank);
    let actions = capabilities
        .iter()
        .map(|capability| evm_funding_action(intent, asset, capability, &payload.payer_address))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(EvmPaymentActionsResponse {
        checkout_id,
        intent_id: intent.intent_id.clone(),
        chain_id: intent.chain_id,
        settlement_contract: intent.settlement_contract.clone(),
        token_contract: intent.token_contract.clone(),
        expected_amount_minor_units: intent.expected_amount_minor_units,
        actions,
    }))
}

fn evm_funding_action(
    intent: &EvmPaymentIntent,
    asset: &SupportedEvmAsset,
    capability: &EvmFundingCapability,
    payer_address: &str,
) -> Result<EvmFundingAction, ApiError> {
    let disabled_reason = if matches!(intent.status, EvmPaymentIntentStatus::RequiresPayment)
        && intent.expires_at > Utc::now()
    {
        None
    } else {
        Some("payment intent is not open".to_string())
    };

    let action = match capability.method {
        EvmFundingMethod::Eip3009 => {
            let domain_name = capability
                .eip712_domain_name
                .clone()
                .ok_or(ApiError::internal(
                    "EIP-3009 capability missing EIP-712 domain name",
                ))?;
            let domain_version = capability
                .eip712_domain_version
                .clone()
                .unwrap_or_else(|| "1".to_string());
            let deadline = intent.expires_at.timestamp() as u64;
            let nonce = payment_authorization_hash(intent, payer_address, deadline)?;
            let typed_data = serde_json::json!({
                "domain": {
                    "name": domain_name,
                    "version": domain_version,
                    "chainId": intent.chain_id,
                    "verifyingContract": intent.token_contract,
                },
                "types": {
                    "ReceiveWithAuthorization": [
                        {"name": "from", "type": "address"},
                        {"name": "to", "type": "address"},
                        {"name": "value", "type": "uint256"},
                        {"name": "validAfter", "type": "uint256"},
                        {"name": "validBefore", "type": "uint256"},
                        {"name": "nonce", "type": "bytes32"}
                    ]
                },
                "primaryType": "ReceiveWithAuthorization",
                "message": {
                    "from": payer_address,
                    "to": intent.settlement_contract,
                    "value": intent.expected_amount_minor_units.to_string(),
                    "validAfter": "0",
                    "validBefore": deadline.to_string(),
                    "nonce": nonce,
                }
            });
            EvmFundingAction {
                method: capability.method,
                rank: capability.rank,
                title: "Gasless authorization".to_string(),
                description:
                    "Sign an EIP-3009 authorization and let the ZamaPay relayer submit settlement."
                        .to_string(),
                button_label: "Pay gasless".to_string(),
                contract_function: "payWithAuthorization".to_string(),
                gasless: true,
                requires_wallet_signature: true,
                requires_transaction: false,
                requires_token_approval: false,
                approval_target: None,
                disabled_reason,
                authorization: Some(EvmFundingAuthorization {
                    typed_data,
                    settlement_args: serde_json::json!({
                        "params": settlement_payment_params(intent),
                        "authorization": {
                            "payer": payer_address,
                            "validAfter": "0",
                            "validBefore": deadline.to_string(),
                            "nonce": nonce,
                        }
                    }),
                }),
            }
        }
        EvmFundingMethod::Permit2 => {
            let permit2_contract = capability
                .permit2_contract
                .clone()
                .ok_or(ApiError::internal("Permit2 capability missing contract"))?;
            let deadline = intent.expires_at.timestamp() as u64;
            let witness = payment_authorization_hash(intent, payer_address, deadline)?;
            let permit_nonce = permit2_nonce_from_witness(&witness)?;
            EvmFundingAction {
                method: capability.method,
                rank: capability.rank,
                title: "Gasless Permit2 witness".to_string(),
                description:
                    "Use Permit2 witness data, then let the ZamaPay relayer submit settlement."
                        .to_string(),
                button_label: "Pay gasless with Permit2".to_string(),
                contract_function: "payWithPermit2".to_string(),
                gasless: true,
                requires_wallet_signature: true,
                requires_transaction: false,
                requires_token_approval: true,
                approval_target: Some(permit2_contract.clone()),
                disabled_reason,
                authorization: Some(EvmFundingAuthorization {
                    typed_data: serde_json::json!({
                        "domain": {
                            "name": "Permit2",
                            "chainId": intent.chain_id,
                            "verifyingContract": permit2_contract,
                        },
                        "types": {
                            "TokenPermissions": [
                                {"name": "token", "type": "address"},
                                {"name": "amount", "type": "uint256"}
                            ],
                            "ZamaPayEvmPayment": payment_authorization_type_fields(),
                            "PermitWitnessTransferFrom": [
                                {"name": "permitted", "type": "TokenPermissions"},
                                {"name": "spender", "type": "address"},
                                {"name": "nonce", "type": "uint256"},
                                {"name": "deadline", "type": "uint256"},
                                {"name": "witness", "type": "ZamaPayEvmPayment"}
                            ]
                        },
                        "primaryType": "PermitWitnessTransferFrom",
                        "message": {
                            "permitted": {
                                "token": intent.token_contract,
                                "amount": intent.expected_amount_minor_units.to_string(),
                            },
                            "spender": intent.settlement_contract,
                            "nonce": permit_nonce,
                            "deadline": deadline.to_string(),
                            "witness": payment_authorization_message(intent, payer_address, deadline),
                        },
                    }),
                    settlement_args: serde_json::json!({
                        "params": settlement_payment_params(intent),
                        "permit2": {
                            "permit2": permit2_contract,
                            "payer": payer_address,
                            "permit": {
                                "permitted": {
                                    "token": intent.token_contract,
                                    "amount": intent.expected_amount_minor_units.to_string(),
                                },
                                "nonce": permit_nonce,
                                "deadline": deadline.to_string(),
                            },
                            "witness": witness,
                            "witnessTypeString": PERMIT2_PAYMENT_WITNESS_TYPE_STRING,
                        }
                    }),
                }),
            }
        }
        EvmFundingMethod::Erc2612 => {
            let domain_name = capability
                .eip712_domain_name
                .clone()
                .ok_or(ApiError::internal(
                    "ERC-2612 capability missing EIP-712 domain name",
                ))?;
            let domain_version = capability
                .eip712_domain_version
                .clone()
                .unwrap_or_else(|| "1".to_string());
            let deadline = intent.expires_at.timestamp() as u64;
            EvmFundingAction {
                method: capability.method,
                rank: capability.rank,
                title: "ERC-2612 permit payment".to_string(),
                description:
                    "Sign a token permit and submit the settlement payment from the payer wallet."
                        .to_string(),
                button_label: "Pay with permit".to_string(),
                contract_function: "payWithPermit".to_string(),
                gasless: false,
                requires_wallet_signature: true,
                requires_transaction: true,
                requires_token_approval: false,
                approval_target: None,
                disabled_reason,
                authorization: Some(EvmFundingAuthorization {
                    typed_data: serde_json::json!({
                        "domain": {
                            "name": domain_name,
                            "version": domain_version,
                            "chainId": intent.chain_id,
                            "verifyingContract": intent.token_contract,
                        },
                        "types": {
                            "Permit": [
                                {"name": "owner", "type": "address"},
                                {"name": "spender", "type": "address"},
                                {"name": "value", "type": "uint256"},
                                {"name": "nonce", "type": "uint256"},
                                {"name": "deadline", "type": "uint256"}
                            ]
                        },
                        "primaryType": "Permit",
                        "message": {
                            "owner": payer_address,
                            "spender": intent.settlement_contract,
                            "value": intent.expected_amount_minor_units.to_string(),
                            "nonce": null,
                            "deadline": deadline.to_string(),
                        },
                        "requiresOnchainNonce": true,
                    }),
                    settlement_args: serde_json::json!({
                        "params": settlement_payment_params(intent),
                        "permit": {
                            "deadline": deadline.to_string(),
                        }
                    }),
                }),
            }
        }
        EvmFundingMethod::ApprovePay => EvmFundingAction {
            method: capability.method,
            rank: capability.rank,
            title: "Standard ERC20 approval".to_string(),
            description: "Approve the settlement contract, then call pay as the fallback path."
                .to_string(),
            button_label: "Approve and pay".to_string(),
            contract_function: "pay".to_string(),
            gasless: false,
            requires_wallet_signature: false,
            requires_transaction: true,
            requires_token_approval: true,
            approval_target: Some(asset.settlement_contract.clone()),
            disabled_reason,
            authorization: Some(EvmFundingAuthorization {
                typed_data: serde_json::json!(null),
                settlement_args: serde_json::json!({
                    "params": settlement_payment_params(intent),
                }),
            }),
        },
    };
    Ok(action)
}

fn settlement_payment_params(intent: &EvmPaymentIntent) -> serde_json::Value {
    serde_json::json!({
        "intentId": intent.settlement_intent_id,
        "projectId": intent.settlement_project_id,
        "token": intent.token_contract,
        "grossAmount": intent.expected_amount_minor_units.to_string(),
        "merchantNetAmount": intent.merchant_net_minor_units.to_string(),
        "platformFeeAmount": intent.platform_fee_minor_units.to_string(),
        "expiresAt": intent.expires_at.timestamp().to_string(),
    })
}

fn payment_authorization_type_fields() -> serde_json::Value {
    serde_json::json!([
        {"name": "intentId", "type": "bytes32"},
        {"name": "projectId", "type": "bytes32"},
        {"name": "payer", "type": "address"},
        {"name": "token", "type": "address"},
        {"name": "grossAmount", "type": "uint256"},
        {"name": "merchantNetAmount", "type": "uint256"},
        {"name": "platformFeeAmount", "type": "uint256"},
        {"name": "settlement", "type": "address"},
        {"name": "chainId", "type": "uint256"},
        {"name": "deadline", "type": "uint256"}
    ])
}

fn payment_authorization_message(
    intent: &EvmPaymentIntent,
    payer_address: &str,
    deadline: u64,
) -> serde_json::Value {
    serde_json::json!({
        "intentId": intent.settlement_intent_id,
        "projectId": intent.settlement_project_id,
        "payer": payer_address,
        "token": intent.token_contract,
        "grossAmount": intent.expected_amount_minor_units.to_string(),
        "merchantNetAmount": intent.merchant_net_minor_units.to_string(),
        "platformFeeAmount": intent.platform_fee_minor_units.to_string(),
        "settlement": intent.settlement_contract,
        "chainId": intent.chain_id.to_string(),
        "deadline": deadline.to_string(),
    })
}

fn payment_authorization_hash(
    intent: &EvmPaymentIntent,
    payer_address: &str,
    deadline: u64,
) -> Result<String, ApiError> {
    let type_hash = keccak256(EVM_PAYMENT_AUTHORIZATION_TYPE.as_bytes());
    let intent_id = parse_h256("settlementIntentId", &intent.settlement_intent_id)?;
    let project_id = parse_h256("settlementProjectId", &intent.settlement_project_id)?;
    let payer = parse_address("payerAddress", payer_address)?;
    let token = parse_address("tokenContract", &intent.token_contract)?;
    let settlement = parse_address("settlementContract", &intent.settlement_contract)?;
    let encoded = encode(&[
        Token::FixedBytes(type_hash.to_vec()),
        Token::FixedBytes(intent_id.as_bytes().to_vec()),
        Token::FixedBytes(project_id.as_bytes().to_vec()),
        Token::Address(payer),
        Token::Address(token),
        Token::Uint(U256::from(intent.expected_amount_minor_units)),
        Token::Uint(U256::from(intent.merchant_net_minor_units)),
        Token::Uint(U256::from(intent.platform_fee_minor_units)),
        Token::Address(settlement),
        Token::Uint(U256::from(intent.chain_id)),
        Token::Uint(U256::from(deadline)),
    ]);
    Ok(format!("0x{}", hex_lower(&keccak256(encoded))))
}

fn permit2_nonce_from_witness(witness: &str) -> Result<String, ApiError> {
    let witness_hash = parse_h256("permit2Witness", witness)?;
    Ok(U256::from_big_endian(witness_hash.as_bytes()).to_string())
}

fn parse_address(label: &str, value: &str) -> Result<Address, ApiError> {
    Address::from_str(value.trim())
        .map_err(|_| ApiError::bad_request(format!("{label} must be a 20-byte hex address")))
}

fn parse_h256(label: &str, value: &str) -> Result<H256, ApiError> {
    H256::from_str(value.trim())
        .map_err(|_| ApiError::bad_request(format!("{label} must be a 32-byte hex hash")))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

async fn create_invoice(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(payload): Json<CreateInvoiceRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;

    let title = payload.title.trim();
    let amount_label = payload.amount_label.trim();
    let note = payload.note.trim();

    if title.is_empty()
        || amount_label.is_empty()
        || note.is_empty()
        || payload.amount_minor_units == 0
    {
        return Err(ApiError::bad_request(
            "title, amountLabel, amountMinorUnits, and note are required",
        ));
    }

    Ok(Json(
        state
            .portal
            .create_invoice(
                title,
                amount_label,
                payload.amount_minor_units,
                note,
                payload.external_ref.as_deref(),
                payload.chain_invoice_id,
                payload.chain_tx_hash.as_deref(),
            )
            .await,
    ))
}

async fn invoice_detail(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let invoice = state
        .portal
        .invoice_by_id(&invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;
    Ok(Json(invoice))
}

async fn invoice_fulfillment(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
) -> Result<Json<FulfillmentResponse>, ApiError> {
    let mut invoice = state
        .portal
        .invoice_by_id(&invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    if decide(&invoice.snapshot) == FulfillmentDecision::EnqueueRelease
        && invoice.fulfillment_release.is_none()
    {
        invoice = state
            .portal
            .release_fulfillment(&invoice_id, Utc::now(), 0)
            .await
            .ok_or(ApiError::not_found("invoice not found"))?;
    }

    Ok(Json(fulfillment_response(&invoice)))
}

async fn request_invoice_decrypt(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(invoice_id): Path<String>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    let _session = session_from_cookie(&state, &jar)
        .await?
        .ok_or(ApiError::unauthorized("missing session"))?;

    match state
        .portal
        .request_invoice_decrypt(&invoice_id, Utc::now())
        .await
    {
        Some(DecryptRequestProjection::Created(invoice)) => Ok(Json(invoice)),
        Some(DecryptRequestProjection::AlreadyPending(_)) => {
            Err(ApiError::conflict("decrypt request already pending"))
        }
        Some(DecryptRequestProjection::NotPaid(_)) => {
            Err(ApiError::conflict("decrypt request requires paid invoice"))
        }
        None => Err(ApiError::not_found("invoice not found")),
    }
}

async fn operator_diagnostics(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<OperatorDiagnostics>, ApiError> {
    require_operator_key(&state, &headers).await?;

    Ok(Json(
        state
            .portal
            .operator_diagnostics(state.operator_auth_rejections().await)
            .await,
    ))
}

async fn evm_indexer_watchlist(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<EvmIndexerWatchlist>, ApiError> {
    require_operator_key(&state, &headers).await?;
    Ok(Json(state.portal.evm_indexer_watchlist(Utc::now()).await))
}

async fn project_evm_settlement_event(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<EvmSettlementEventProjectionRequest>,
) -> Result<Json<EvmSettlementEventProjectionResponse>, ApiError> {
    require_operator_key(&state, &headers).await?;
    validate_evm_settlement_event_projection(&payload)?;
    let projected = state
        .portal
        .project_evm_settlement_event(payload, Utc::now())
        .await;
    if let Some(invoice) = projected.invoice.as_ref() {
        if invoice.snapshot.is_fulfillment_ready() {
            if let Some(project_id) = invoice.project_id.as_deref() {
                projects::dispatch_project_deliveries(&state, project_id).await?;
            }
        }
    }
    Ok(Json(projected))
}

async fn project_evm_indexer_cursor(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<EvmIndexerCursorProjectionRequest>,
) -> Result<Json<EvmIndexerCursor>, ApiError> {
    require_operator_key(&state, &headers).await?;
    validate_evm_cursor_projection(&payload)?;
    Ok(Json(
        state
            .portal
            .project_evm_indexer_cursor(payload, Utc::now())
            .await,
    ))
}

async fn project_invoice_payment(
    State(state): State<AppState>,
    Path(invoice_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;

    let invoice = state
        .portal
        .project_invoice_paid(
            &invoice_id,
            payload.chain_invoice_id,
            payment_tx_hash,
            payer_address,
        )
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_payment(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentProjectionRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let (payment_tx_hash, payer_address) = validated_payment_projection(&payload)?;
    let invoice = state
        .portal
        .project_chain_invoice_paid(chain_invoice_id, payment_tx_hash, payer_address)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn project_chain_invoice_confirmations(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<PaymentConfirmationsRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;
    let finality_threshold = payload
        .finality_threshold
        .unwrap_or(DEFAULT_FINALITY_THRESHOLD);
    let mut projection = ProjectionState::from_snapshot(invoice.snapshot, finality_threshold);
    projection.apply_confirmations(payload.confirmations);

    let invoice = state
        .portal
        .project_chain_invoice_finality_snapshot(
            chain_invoice_id,
            projection.snapshot().clone(),
            payload.confirmations,
            finality_threshold,
        )
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    if let Some(project_id) = invoice.project_id.as_deref() {
        projects::dispatch_project_deliveries(&state, project_id).await?;
    }

    Ok(Json(invoice))
}

async fn project_chain_invoice_settlement_event(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<OperatorSettlementEventRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let invoice = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;
    let finality_threshold = payload
        .finality_threshold
        .unwrap_or(DEFAULT_FINALITY_THRESHOLD);
    let mut projection = ProjectionState::from_snapshot(invoice.snapshot, finality_threshold);
    projection.apply_operator_event(payload.event);

    let invoice = state
        .portal
        .project_chain_invoice_snapshot(chain_invoice_id, projection.snapshot().clone())
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    if let Some(project_id) = invoice.project_id.as_deref() {
        projects::dispatch_project_deliveries(&state, project_id).await?;
    }

    Ok(Json(invoice))
}

async fn project_chain_invoice_webhook_delivery(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<WebhookDeliveryRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_operator_key(&state, &headers).await?;

    let max_attempts = validated_webhook_max_attempts(payload.max_attempts)?;
    let invoice = state
        .portal
        .project_chain_invoice_webhook_delivery(chain_invoice_id, payload.outcome, max_attempts)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok(Json(invoice))
}

async fn chain_invoice_webhook_dispatch(
    State(state): State<AppState>,
    Path(chain_invoice_id): Path<u64>,
    headers: axum::http::HeaderMap,
) -> Result<(StatusCode, &'static str), ApiError> {
    require_operator_key(&state, &headers).await?;

    let _ = state
        .portal
        .invoice_by_chain_invoice_id(chain_invoice_id)
        .await
        .ok_or(ApiError::not_found("invoice not found"))?;

    Ok((
        StatusCode::GONE,
        "operator webhook dispatch was retired; use project webhook delivery outbox",
    ))
}

async fn project_decrypt_callback(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<DecryptCallbackRequest>,
) -> Result<Json<InvoiceRecord>, ApiError> {
    require_gateway_key(&headers)?;

    let callback_sender = payload.callback_sender.trim();
    if callback_sender.is_empty() {
        return Err(ApiError::bad_request("callbackSender is required"));
    }

    let invoice = state
        .portal
        .project_decrypt_callback(&request_id, payload.outcome, callback_sender, Utc::now())
        .await
        .ok_or(ApiError::not_found("decrypt request not found"))?;

    Ok(Json(invoice))
}

fn validated_payment_projection(
    payload: &PaymentProjectionRequest,
) -> Result<(&str, &str), ApiError> {
    let payment_tx_hash = payload.payment_tx_hash.trim();
    let payer_address = payload.payer_address.trim();

    if payment_tx_hash.is_empty() || payer_address.is_empty() {
        return Err(ApiError::bad_request(
            "paymentTxHash and payerAddress are required",
        ));
    }

    Ok((payment_tx_hash, payer_address))
}

fn validate_evm_settlement_event_projection(
    payload: &EvmSettlementEventProjectionRequest,
) -> Result<(), ApiError> {
    if payload.chain_id == 0 {
        return Err(ApiError::bad_request("chainId must be greater than zero"));
    }
    if payload.amount_minor_units == 0 {
        return Err(ApiError::bad_request(
            "amountMinorUnits must be greater than zero",
        ));
    }
    if payload
        .merchant_net_minor_units
        .checked_add(payload.platform_fee_minor_units)
        != Some(payload.amount_minor_units)
    {
        return Err(ApiError::bad_request(
            "merchantNetMinorUnits plus platformFeeMinorUnits must equal amountMinorUnits",
        ));
    }
    for (label, value) in [
        ("settlementIntentId", payload.settlement_intent_id.as_str()),
        (
            "settlementProjectId",
            payload.settlement_project_id.as_str(),
        ),
        ("settlementContract", payload.settlement_contract.as_str()),
        ("tokenContract", payload.token_contract.as_str()),
        ("txHash", payload.tx_hash.as_str()),
        ("fromAddress", payload.from_address.as_str()),
        ("toAddress", payload.to_address.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(ApiError::bad_request(format!("{label} is required")));
        }
    }
    validate_evm_hash("txHash", &payload.tx_hash)?;
    validate_evm_hash("settlementIntentId", &payload.settlement_intent_id)?;
    validate_evm_hash("settlementProjectId", &payload.settlement_project_id)?;
    if let Some(block_hash) = payload.block_hash.as_deref() {
        validate_evm_hash("blockHash", block_hash)?;
    }
    validate_evm_address("settlementContract", &payload.settlement_contract)?;
    validate_evm_address("tokenContract", &payload.token_contract)?;
    validate_evm_address("fromAddress", &payload.from_address)?;
    validate_evm_address("toAddress", &payload.to_address)?;
    if !payload
        .to_address
        .eq_ignore_ascii_case(&payload.settlement_contract)
    {
        return Err(ApiError::bad_request(
            "toAddress must equal settlementContract",
        ));
    }
    Ok(())
}

fn validate_evm_cursor_projection(
    payload: &EvmIndexerCursorProjectionRequest,
) -> Result<(), ApiError> {
    if payload.chain_id == 0 {
        return Err(ApiError::bad_request("chainId must be greater than zero"));
    }
    if payload.last_finalized_block > payload.last_scanned_block {
        return Err(ApiError::bad_request(
            "lastFinalizedBlock cannot exceed lastScannedBlock",
        ));
    }
    validate_evm_address("settlementContract", &payload.settlement_contract)?;
    Ok(())
}

fn validate_evm_address(label: &str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() != 42
        || !value.starts_with("0x")
        || !value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err(ApiError::bad_request(format!(
            "{label} must be a 20-byte hex address"
        )));
    }
    Ok(())
}

fn validate_evm_hash(label: &str, value: &str) -> Result<(), ApiError> {
    let value = value.trim();
    if value.len() != 66
        || !value.starts_with("0x")
        || !value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err(ApiError::bad_request(format!(
            "{label} must be a 32-byte hex hash"
        )));
    }
    Ok(())
}

fn validated_webhook_max_attempts(max_attempts: Option<u32>) -> Result<u32, ApiError> {
    let max_attempts = max_attempts.unwrap_or(DEFAULT_WEBHOOK_MAX_ATTEMPTS);

    if max_attempts == 0 {
        return Err(ApiError::bad_request(
            "maxAttempts must be greater than zero",
        ));
    }

    Ok(max_attempts)
}

fn fulfillment_response(invoice: &InvoiceRecord) -> FulfillmentResponse {
    let decision = decide(&invoice.snapshot);
    let release = invoice.fulfillment_release.clone();
    let decision =
        if release.is_some() && decision != FulfillmentDecision::FreezeForManualIntervention {
            "released"
        } else {
            decision_label(decision)
        };

    FulfillmentResponse {
        invoice_id: invoice.invoice_id.clone(),
        decision: decision.to_string(),
        artifacts: Vec::new(),
        release,
    }
}

fn decision_label(decision: FulfillmentDecision) -> &'static str {
    match decision {
        FulfillmentDecision::Hold => "hold",
        FulfillmentDecision::EnqueueRelease => "enqueue_release",
        FulfillmentDecision::FreezeForManualIntervention => "freeze_for_manual_intervention",
    }
}

async fn require_operator_key(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<(), ApiError> {
    match validate_operator_key(headers) {
        Ok(()) => Ok(()),
        Err(error) => {
            state.record_operator_auth_rejection().await;
            Err(error)
        }
    }
}

fn validate_operator_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(OPERATOR_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing operator key"));
    };

    let expected =
        std::env::var("ZAMAPAY_OPERATOR_KEY").unwrap_or_else(|_| DEFAULT_OPERATOR_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid operator key"));
    }

    Ok(())
}

fn require_gateway_key(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(provided) = headers.get(GATEWAY_KEY_HEADER) else {
        return Err(ApiError::unauthorized("missing gateway callback key"));
    };

    let expected = std::env::var("ZAMAPAY_GATEWAY_CALLBACK_KEY")
        .unwrap_or_else(|_| DEFAULT_GATEWAY_CALLBACK_KEY.to_string());
    if provided != expected.as_str() {
        return Err(ApiError::unauthorized("invalid gateway callback key"));
    }

    Ok(())
}

async fn session_from_cookie(
    state: &AppState,
    jar: &CookieJar,
) -> Result<Option<StoredSession>, ApiError> {
    let Some(raw_session_cookie) = jar.get(SESSION_COOKIE_NAME) else {
        return Ok(None);
    };

    let session_id = Uuid::parse_str(raw_session_cookie.value())
        .map_err(|_| ApiError::unauthorized("invalid session"))?;
    let Some(session) = state.store.find_session(&session_id).await else {
        return Ok(None);
    };

    Ok(Some(session))
}

fn session_id_from_cookie_lossy(jar: &CookieJar) -> Option<Uuid> {
    jar.get(SESSION_COOKIE_NAME)
        .and_then(|cookie| Uuid::parse_str(cookie.value()).ok())
}

fn recover_and_compare_address(
    message: &str,
    signature: &str,
    expected_address: &str,
) -> Result<(), ApiError> {
    let signature = Signature::from_str(signature)
        .map_err(|_| ApiError::unauthorized("invalid signature encoding"))?;
    let digest = hash_message(message);
    let recovered = signature
        .recover(digest)
        .map_err(|_| ApiError::unauthorized("signature recovery failed"))?;

    let expected = Address::from_str(expected_address)
        .map_err(|_| ApiError::bad_request("invalid address"))?;
    if recovered != expected {
        return Err(ApiError::unauthorized("signature address mismatch"));
    }

    Ok(())
}

fn normalize_address(raw: &str) -> Result<String, ApiError> {
    let parsed = Address::from_str(raw).map_err(|_| ApiError::bad_request("invalid address"))?;
    Ok(format!("{parsed:?}"))
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn locked(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::LOCKED,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.status, self.message).into_response()
    }
}
