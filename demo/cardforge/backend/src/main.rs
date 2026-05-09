use std::{
    collections::BTreeMap,
    env, fs, io,
    net::SocketAddr,
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use ethers_core::utils::keccak256;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{net::TcpListener, time::sleep};
use tower_http::{cors::AllowOrigin, cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8092";
const DEFAULT_API_URL: &str = "http://127.0.0.1:8080";
const DEFAULT_CHAIN_INVOICE_API_URL: &str = "http://127.0.0.1:3001";
const DEFAULT_CONSOLE_URL: &str = "http://127.0.0.1:3001/merchant";
const DEFAULT_LOGIN_URL: &str = "http://127.0.0.1:3001/login";
const DEFAULT_MERCHANT_LABEL: &str = "CardForge Demo Store";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://127.0.0.1:8092/api/mermer-pay/webhook";
const DEMO_BACKEND_PROCESS_NAME: &str = "cardforge-backend";
const DEFAULT_PRODUCT_ID: &str = "mythic-loadout";
const DEFAULT_DATA_PATH: &str = ".cardforge-data.json";
const LOCAL_CHAIN_ID: u64 = 31337;

type DynError = Box<dyn std::error::Error>;

#[derive(Clone, Debug, Eq, PartialEq)]
struct PortListener {
    pid: u32,
    command: String,
}

static PRODUCT_CATALOG: &[ProductDefinition] = &[
    ProductDefinition {
        amount_label: "40 cUSDT",
        amount_minor_units: 40_000_000,
        codes: &["Credit shard", "Starter boost", "Instant access code"],
        id: "neon-credit",
        note: "Credit shard, starter boost, and one instant access code release after Mermer Pay reports finality-safe payment.",
        title: "Neon Credit Card",
    },
    ProductDefinition {
        amount_label: "80 cUSDT",
        amount_minor_units: 80_000_000,
        codes: &["Arena entry code", "Demo wallet credit", "Reward slot code"],
        id: "arena-access",
        note: "Match entry, demo wallet credit, and a timed reward slot release after finality-safe payment.",
        title: "Arena Access Card",
    },
    ProductDefinition {
        amount_label: "120 cUSDT",
        amount_minor_units: 120_000_000,
        codes: &[
            "SEA prepaid code",
            "Game wallet code",
            "Instant access code",
        ],
        id: DEFAULT_PRODUCT_ID,
        note: "Three CardForge demo codes release after Mermer Pay reports finality-safe payment.",
        title: "Mythic Loadout Card",
    },
    ProductDefinition {
        amount_label: "160 cUSDT",
        amount_minor_units: 160_000_000,
        codes: &[
            "Cosmetic vault code",
            "Skin claim code",
            "Delivery receipt code",
        ],
        id: "cyber-skin",
        note: "Cosmetic vault claim codes release after encrypted checkout finality.",
        title: "Cyber Skin Card",
    },
    ProductDefinition {
        amount_label: "200 cUSDT",
        amount_minor_units: 200_000_000,
        codes: &[
            "Founder credit code",
            "Premium access code",
            "Vault drop code",
        ],
        id: "founders-drop",
        note: "Premium pack codes for credits, access, loadout, and vault drops release after finality-safe payment.",
        title: "Founders Drop Card",
    },
];

#[derive(Clone)]
struct AppState {
    client: Client,
    config: Arc<Config>,
    fulfillment: Arc<Mutex<FulfillmentState>>,
    orders: Arc<Mutex<LocalOrderStore>>,
    webhooks: Arc<Mutex<Vec<WebhookReceipt>>>,
}

#[derive(Clone)]
struct Config {
    bind_addr: SocketAddr,
    data_path: PathBuf,
    local_chain_invoice_api_url: String,
    login_url: String,
    mermer_api_url: String,
    mermer_console_url: String,
    project_api_key: String,
    merchant_label: String,
    project_id: String,
    webhook_endpoint: String,
    webhook_secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    amount_label: String,
    amount_minor_units: u64,
    codes: Vec<String>,
    id: String,
    title: String,
}

struct ProductDefinition {
    amount_label: &'static str,
    amount_minor_units: u64,
    codes: &'static [&'static str],
    id: &'static str,
    note: &'static str,
    title: &'static str,
}

#[derive(Clone, Default)]
struct FulfillmentState {
    release_order: Vec<String>,
    released_orders: BTreeMap<String, ReleasedOrder>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FulfillmentSnapshot {
    cards: Vec<ReleasedCard>,
    latest_release: Option<ReleasedOrder>,
    released: bool,
    released_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleasedOrder {
    amount_label: Option<String>,
    cards: Vec<ReleasedCard>,
    checkout_session_id: String,
    invoice_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleasedCard {
    label: String,
    secret: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorefrontResponse {
    merchant_label: String,
    mermer_console_url: String,
    mermer_login_url: String,
    product: Product,
    products: Vec<Product>,
    project_id: String,
    webhook_endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutResponse {
    billing: CheckoutBillingSnapshot,
    chain_invoice_id: u64,
    checkout_url: String,
    checkout_session_id: String,
    invoice_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCheckoutRequest {
    buyer_wallet_address: Option<String>,
    product_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutBillingSnapshot {
    fee_bps: u16,
    gross_amount_minor_units: u64,
    merchant_net_minor_units: u64,
    platform_fee_minor_units: u64,
    plan: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateCheckoutSessionRequest {
    amount_label: String,
    amount_minor_units: u64,
    cancel_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chain_invoice_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chain_tx_hash: Option<String>,
    merchant_order_id: String,
    metadata: std::collections::BTreeMap<String, String>,
    note: String,
    success_url: Option<String>,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MermerCheckoutSessionResponse {
    billing: CheckoutBillingSnapshot,
    chain_invoice_id: u64,
    checkout_session_id: String,
    checkout_url: String,
    invoice_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalChainInvoiceResponse {
    chain_invoice_id: u64,
    chain_tx_hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookReceipt {
    id: Option<String>,
    signature: Option<String>,
    payload: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookAck {
    received: bool,
    received_event_count: usize,
    release_status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookLog {
    events: Vec<WebhookReceipt>,
    received_event_count: usize,
}

struct LocalOrderStore {
    data: LocalOrderData,
    path: PathBuf,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalOrderData {
    #[serde(default)]
    owned_cards: Vec<OwnedCard>,
    #[serde(default)]
    pending_orders: BTreeMap<String, PendingOrder>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingOrder {
    amount_label: String,
    amount_minor_units: u64,
    buyer_wallet_address: Option<String>,
    chain_invoice_id: u64,
    checkout_session_id: String,
    created_at: String,
    invoice_id: String,
    product_id: String,
    product_title: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedCard {
    amount_label: String,
    amount_minor_units: u64,
    cards: Vec<ReleasedCard>,
    chain_invoice_id: u64,
    checkout_session_id: String,
    id: String,
    invoice_id: String,
    payment_tx_hash: Option<String>,
    product_id: String,
    purchased_at: String,
    title: String,
    wallet_address: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletActivityResponse {
    owned_cards: Vec<OwnedCard>,
    payments: Vec<WalletPaymentRecord>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletPaymentRecord {
    amount_label: String,
    amount_minor_units: String,
    chain_id: u64,
    chain_invoice_id: Option<u64>,
    checkout_session_id: Option<String>,
    recorded_at: String,
    status: &'static str,
    tx_hash: String,
    #[serde(rename = "type")]
    record_type: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    login_url: Option<String>,
    message: String,
}

struct ApiError {
    body: ErrorBody,
    status: StatusCode,
}

#[tokio::main]
async fn main() -> Result<(), DynError> {
    let config = Config::from_env()?;
    let bind_addr = config.bind_addr;
    let state = AppState::new(config);
    let listener = bind_demo_listener(bind_addr).await?;

    println!("CardForge backend listening on http://{bind_addr}");
    axum::serve(listener, app(state)).await?;

    Ok(())
}

async fn bind_demo_listener(bind_addr: SocketAddr) -> Result<TcpListener, DynError> {
    match TcpListener::bind(bind_addr).await {
        Ok(listener) => Ok(listener),
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            stop_previous_cardforge_backend(bind_addr, "-TERM")?;
            wait_for_released_port(bind_addr).await
        }
        Err(error) => Err(error.into()),
    }
}

async fn wait_for_released_port(bind_addr: SocketAddr) -> Result<TcpListener, DynError> {
    for attempt in 0..20 {
        sleep(Duration::from_millis(100)).await;

        match TcpListener::bind(bind_addr).await {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
                if attempt == 9 {
                    stop_previous_cardforge_backend(bind_addr, "-KILL")?;
                }
            }
            Err(error) => return Err(error.into()),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AddrInUse,
        format!("port {bind_addr} stayed busy after replacing the old CardForge backend"),
    )
    .into())
}

fn stop_previous_cardforge_backend(bind_addr: SocketAddr, signal: &str) -> Result<(), DynError> {
    let listeners = listeners_on_port(bind_addr.port())?;
    let matching: Vec<_> = listeners
        .iter()
        .filter(|listener| is_cardforge_backend_command(&listener.command))
        .cloned()
        .collect();

    if matching.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            format!(
                "port {bind_addr} is occupied, but no {DEMO_BACKEND_PROCESS_NAME} listener was found: {}",
                listener_summary(&listeners)
            ),
        )
        .into());
    }

    for listener in matching {
        println!(
            "CardForge backend port {bind_addr} is occupied by PID {}; sending {signal}.",
            listener.pid
        );
        signal_process(listener.pid, signal)?;
    }

    Ok(())
}

fn listeners_on_port(port: u16) -> Result<Vec<PortListener>, DynError> {
    let port_filter = format!("-iTCP:{port}");
    let output = Command::new("lsof")
        .args(["-nP", &port_filter, "-sTCP:LISTEN", "-t"])
        .output()?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(Vec::new());
    }

    let mut pids = parse_lsof_pids(&output.stdout);
    pids.sort_unstable();
    pids.dedup();

    let listeners = pids
        .into_iter()
        .filter_map(|pid| {
            let command = process_command(pid).ok()?;
            (!command.is_empty()).then_some(PortListener { pid, command })
        })
        .collect();

    Ok(listeners)
}

fn parse_lsof_pids(stdout: &[u8]) -> Vec<u32> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

fn process_command(pid: u32) -> Result<String, DynError> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn signal_process(pid: u32, signal: &str) -> Result<(), DynError> {
    let status = Command::new("kill")
        .args([signal, &pid.to_string()])
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("failed to send {signal} to PID {pid}")).into())
    }
}

fn is_cardforge_backend_command(command: &str) -> bool {
    command.contains(DEMO_BACKEND_PROCESS_NAME)
}

fn listener_summary(listeners: &[PortListener]) -> String {
    if listeners.is_empty() {
        return "no visible listener".to_string();
    }

    listeners
        .iter()
        .map(|listener| format!("PID {} ({})", listener.pid, listener.command))
        .collect::<Vec<_>>()
        .join(", ")
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/storefront", get(storefront))
        .route("/api/fulfillment", get(fulfillment))
        .route("/api/orders/checkout", post(create_checkout))
        .route(
            "/api/wallets/{wallet_address}/activity",
            get(wallet_activity),
        )
        .route("/api/mermer-pay/webhook", post(receive_webhook))
        .route("/api/mermer-pay/webhooks", get(webhook_log))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors())
}

impl AppState {
    fn new(config: Config) -> Self {
        let orders = LocalOrderStore::load(config.data_path.clone());

        Self {
            client: Client::new(),
            config: Arc::new(config),
            fulfillment: Arc::new(Mutex::new(FulfillmentState::default())),
            orders: Arc::new(Mutex::new(orders)),
            webhooks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl Config {
    fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        let mermer_console_url =
            clean_base_url(env_value("MERMER_PAY_CONSOLE_URL", DEFAULT_CONSOLE_URL));
        Ok(Self {
            bind_addr: env_value("CARDFORGE_BACKEND_BIND", DEFAULT_BIND_ADDR).parse()?,
            data_path: PathBuf::from(env_value("CARDFORGE_DATA_PATH", DEFAULT_DATA_PATH)),
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
            webhook_endpoint: env_value("CARDFORGE_WEBHOOK_ENDPOINT", DEFAULT_WEBHOOK_ENDPOINT),
            webhook_secret: required_env("MERMER_PAY_WEBHOOK_SECRET")?,
        })
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn storefront(State(state): State<AppState>) -> Json<StorefrontResponse> {
    Json(StorefrontResponse {
        merchant_label: state.config.merchant_label.clone(),
        mermer_console_url: state.config.mermer_console_url.clone(),
        mermer_login_url: state.config.login_url.clone(),
        product: product(default_product()),
        products: PRODUCT_CATALOG.iter().map(product).collect(),
        project_id: state.config.project_id.clone(),
        webhook_endpoint: state.config.webhook_endpoint.clone(),
    })
}

async fn fulfillment(State(state): State<AppState>) -> Result<Json<FulfillmentSnapshot>, ApiError> {
    Ok(Json(fulfillment_snapshot(&state)?))
}

async fn create_checkout(
    State(state): State<AppState>,
    request: Option<Json<CreateCheckoutRequest>>,
) -> Result<Json<CheckoutResponse>, ApiError> {
    let request = request.map(|Json(payload)| payload);
    let product_id = request
        .as_ref()
        .and_then(|payload| payload.product_id.as_deref());
    let buyer_wallet_address = normalize_optional_wallet_address(
        request
            .as_ref()
            .and_then(|payload| payload.buyer_wallet_address.as_deref()),
    )?;
    let selected = selected_product(product_id)?;
    let checkout = create_mermer_checkout_session(&state, selected).await?;
    record_pending_checkout(&state, selected, &checkout, buyer_wallet_address)?;

    Ok(Json(CheckoutResponse {
        billing: checkout.billing,
        chain_invoice_id: checkout.chain_invoice_id,
        checkout_session_id: checkout.checkout_session_id,
        checkout_url: checkout.checkout_url,
        invoice_id: checkout.invoice_id,
    }))
}

async fn wallet_activity(
    State(state): State<AppState>,
    Path(wallet_address): Path<String>,
) -> Result<Json<WalletActivityResponse>, ApiError> {
    let wallet_address = normalize_wallet_address(&wallet_address)?;
    Ok(Json(wallet_activity_snapshot(&state, &wallet_address)?))
}

async fn receive_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<WebhookAck>, ApiError> {
    verify_webhook_signature(&state.config, &headers, &payload)?;
    let release_status = release_from_webhook(&state, &payload)?;
    let receipt = WebhookReceipt {
        id: header_text(&headers, "x-mermer-webhook-id"),
        signature: header_text(&headers, "x-mermer-webhook-signature"),
        payload,
    };
    let received_event_count = push_webhook(&state, receipt)?;

    Ok(Json(WebhookAck {
        received: true,
        received_event_count,
        release_status,
    }))
}

async fn webhook_log(State(state): State<AppState>) -> Result<Json<WebhookLog>, ApiError> {
    let events = webhooks(&state)?;

    Ok(Json(WebhookLog {
        received_event_count: events.len(),
        events,
    }))
}

async fn create_mermer_checkout_session(
    state: &AppState,
    selected: &ProductDefinition,
) -> Result<MermerCheckoutSessionResponse, ApiError> {
    let mut payload = checkout_payload(selected);
    let chain_invoice = create_local_chain_invoice(state, &payload).await?;
    payload.chain_invoice_id = Some(chain_invoice.chain_invoice_id);
    payload.chain_tx_hash = Some(chain_invoice.chain_tx_hash);

    let response = state
        .client
        .post(format!(
            "{}/api/projects/{}/checkout-sessions",
            state.config.mermer_api_url, state.config.project_id
        ))
        .bearer_auth(&state.config.project_api_key)
        .header("idempotency-key", &payload.merchant_order_id)
        .json(&payload)
        .send()
        .await
        .map_err(ApiError::upstream_unreachable)?;
    let status = response.status();

    if status.as_u16() == StatusCode::UNAUTHORIZED.as_u16() {
        return Err(ApiError::project_auth_failed());
    }

    if !status.is_success() {
        return Err(ApiError::upstream_rejected(status.as_u16(), response).await);
    }

    let checkout: MermerCheckoutSessionResponse =
        response.json().await.map_err(ApiError::bad_upstream_json)?;
    if !checkout.billing.is_valid() {
        return Err(ApiError::bad_upstream_shape(
            "Mermer Pay returned an invalid billing split.",
        ));
    }

    Ok(checkout)
}

async fn create_local_chain_invoice(
    state: &AppState,
    payload: &CreateCheckoutSessionRequest,
) -> Result<LocalChainInvoiceResponse, ApiError> {
    let response = state
        .client
        .post(format!(
            "{}/api/dev/local-chain-invoice",
            state.config.local_chain_invoice_api_url
        ))
        .json(&serde_json::json!({
            "amountMinorUnits": payload.amount_minor_units,
            "externalRef": payload.merchant_order_id,
        }))
        .send()
        .await
        .map_err(ApiError::chain_invoice_unreachable)?;
    let status = response.status();

    if !status.is_success() {
        return Err(ApiError::chain_invoice_rejected(status.as_u16(), response).await);
    }

    response
        .json()
        .await
        .map_err(ApiError::bad_chain_invoice_json)
}

impl CheckoutBillingSnapshot {
    fn is_valid(&self) -> bool {
        self.gross_amount_minor_units > 0
            && self.merchant_net_minor_units > 0
            && self.platform_fee_minor_units > 0
            && self
                .merchant_net_minor_units
                .checked_add(self.platform_fee_minor_units)
                == Some(self.gross_amount_minor_units)
    }
}

fn checkout_payload(selected: &ProductDefinition) -> CreateCheckoutSessionRequest {
    let order_id = format!("cardforge-{}-{}", selected.id, Uuid::new_v4().simple());
    let mut metadata = std::collections::BTreeMap::new();
    metadata.insert("productId".to_string(), selected.id.to_string());
    metadata.insert("productTitle".to_string(), selected.title.to_string());
    metadata.insert("source".to_string(), "cardforge".to_string());

    CreateCheckoutSessionRequest {
        amount_label: selected.amount_label.to_string(),
        amount_minor_units: selected.amount_minor_units,
        cancel_url: None,
        chain_invoice_id: None,
        chain_tx_hash: None,
        merchant_order_id: order_id,
        metadata,
        note: selected.note.to_string(),
        success_url: None,
        title: selected.title.to_string(),
    }
}

fn default_product() -> &'static ProductDefinition {
    match selected_product(Some(DEFAULT_PRODUCT_ID)) {
        Ok(product) => product,
        Err(_) => panic!("default product must exist"),
    }
}

fn selected_product(product_id: Option<&str>) -> Result<&'static ProductDefinition, ApiError> {
    let product_id = product_id.unwrap_or(DEFAULT_PRODUCT_ID);
    PRODUCT_CATALOG
        .iter()
        .find(|product| product.id == product_id)
        .ok_or_else(|| {
            ApiError::bad_request(
                "unknown_product",
                format!("CardForge product `{product_id}` does not exist."),
            )
        })
}

fn product_for_amount_minor_units(amount_minor_units: Option<u64>) -> &'static ProductDefinition {
    amount_minor_units
        .and_then(|amount| {
            PRODUCT_CATALOG
                .iter()
                .find(|product| product.amount_minor_units == amount)
        })
        .unwrap_or_else(default_product)
}

fn product(definition: &ProductDefinition) -> Product {
    Product {
        amount_label: definition.amount_label.to_string(),
        amount_minor_units: definition.amount_minor_units,
        codes: definition
            .codes
            .iter()
            .map(|code| code.to_string())
            .collect(),
        id: definition.id.to_string(),
        title: definition.title.to_string(),
    }
}

impl LocalOrderStore {
    fn load(path: PathBuf) -> Self {
        let data = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LocalOrderData>(&raw).ok())
            .unwrap_or_default();

        Self { data, path }
    }

    fn persist(&self) -> Result<(), ApiError> {
        if let Some(parent) = self
            .path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(ApiError::persistence_failed)?;
        }

        let body = serde_json::to_string_pretty(&self.data)
            .map_err(|_| ApiError::internal("CardForge local order state cannot be serialized"))?;
        fs::write(&self.path, body).map_err(ApiError::persistence_failed)
    }

    fn record_pending(&mut self, pending: PendingOrder) -> Result<(), ApiError> {
        self.data
            .pending_orders
            .insert(pending.checkout_session_id.clone(), pending);
        self.persist()
    }

    fn record_owned_card(
        &mut self,
        release: &ReleasedOrder,
        payload: &Value,
    ) -> Result<(), ApiError> {
        let Some(order) = self
            .data
            .pending_orders
            .get(&release.checkout_session_id)
            .cloned()
        else {
            return Ok(());
        };
        let Some(wallet_address) = order.buyer_wallet_address else {
            return Ok(());
        };

        let owned = OwnedCard {
            amount_label: release
                .amount_label
                .clone()
                .unwrap_or_else(|| order.amount_label.clone()),
            amount_minor_units: order.amount_minor_units,
            cards: release.cards.clone(),
            chain_invoice_id: order.chain_invoice_id,
            checkout_session_id: release.checkout_session_id.clone(),
            id: format!("card-{}", release.checkout_session_id),
            invoice_id: release.invoice_id.clone(),
            payment_tx_hash: payload
                .get("paymentTxHash")
                .and_then(Value::as_str)
                .filter(|value| is_transaction_hash(value))
                .map(str::to_string),
            product_id: order.product_id,
            purchased_at: payload
                .get("createdAt")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(epoch_millis),
            title: order.product_title,
            wallet_address,
        };

        if let Some(existing) = self
            .data
            .owned_cards
            .iter_mut()
            .find(|card| card.checkout_session_id == owned.checkout_session_id)
        {
            *existing = owned;
        } else {
            self.data.owned_cards.push(owned);
        }

        self.persist()
    }
}

fn record_pending_checkout(
    state: &AppState,
    selected: &ProductDefinition,
    checkout: &MermerCheckoutSessionResponse,
    buyer_wallet_address: Option<String>,
) -> Result<(), ApiError> {
    let pending = PendingOrder {
        amount_label: selected.amount_label.to_string(),
        amount_minor_units: selected.amount_minor_units,
        buyer_wallet_address,
        chain_invoice_id: checkout.chain_invoice_id,
        checkout_session_id: checkout.checkout_session_id.clone(),
        created_at: epoch_millis(),
        invoice_id: checkout.invoice_id.clone(),
        product_id: selected.id.to_string(),
        product_title: selected.title.to_string(),
    };
    let mut orders = state
        .orders
        .lock()
        .map_err(|_| ApiError::internal("CardForge local order store is unavailable"))?;

    orders.record_pending(pending)
}

fn wallet_activity_snapshot(
    state: &AppState,
    wallet_address: &str,
) -> Result<WalletActivityResponse, ApiError> {
    let orders = state
        .orders
        .lock()
        .map_err(|_| ApiError::internal("CardForge local order store is unavailable"))?;
    let mut owned_cards = orders
        .data
        .owned_cards
        .iter()
        .filter(|card| card.wallet_address == wallet_address)
        .cloned()
        .collect::<Vec<_>>();

    owned_cards.reverse();
    let payments = owned_cards
        .iter()
        .filter_map(payment_record_from_owned_card)
        .collect();

    Ok(WalletActivityResponse {
        owned_cards,
        payments,
    })
}

fn payment_record_from_owned_card(card: &OwnedCard) -> Option<WalletPaymentRecord> {
    let tx_hash = card.payment_tx_hash.as_ref()?.clone();

    Some(WalletPaymentRecord {
        amount_label: card.amount_label.clone(),
        amount_minor_units: card.amount_minor_units.to_string(),
        chain_id: LOCAL_CHAIN_ID,
        chain_invoice_id: Some(card.chain_invoice_id),
        checkout_session_id: Some(card.checkout_session_id.clone()),
        recorded_at: card.purchased_at.clone(),
        status: "confirmed",
        tx_hash,
        record_type: "payment",
    })
}

fn push_webhook(state: &AppState, receipt: WebhookReceipt) -> Result<usize, ApiError> {
    let mut webhooks = state
        .webhooks
        .lock()
        .map_err(|_| ApiError::internal("webhook store is unavailable"))?;

    webhooks.push(receipt);
    Ok(webhooks.len())
}

fn release_from_webhook(state: &AppState, payload: &Value) -> Result<&'static str, ApiError> {
    let Some(release) = release_from_payload(payload) else {
        return Ok("recorded");
    };

    let mut fulfillment = state
        .fulfillment
        .lock()
        .map_err(|_| ApiError::internal("fulfillment store is unavailable"))?;
    let checkout_session_id = release.checkout_session_id.clone();
    let status = if fulfillment
        .released_orders
        .insert(checkout_session_id.clone(), release.clone())
        .is_some()
    {
        "already_released"
    } else {
        fulfillment.release_order.push(checkout_session_id);
        "released"
    };
    drop(fulfillment);
    record_owned_card(state, &release, payload)?;

    Ok(status)
}

fn record_owned_card(
    state: &AppState,
    release: &ReleasedOrder,
    payload: &Value,
) -> Result<(), ApiError> {
    let mut orders = state
        .orders
        .lock()
        .map_err(|_| ApiError::internal("CardForge local order store is unavailable"))?;

    orders.record_owned_card(release, payload)
}

fn release_from_payload(payload: &Value) -> Option<ReleasedOrder> {
    if payload.get("event")?.as_str()? != "invoice.fulfillment_ready" {
        return None;
    }
    if payload.get("paymentTruth")?.as_str()? != "paid" {
        return None;
    }
    if payload.get("finalityStatus")?.as_str()? != "finality_safe" {
        return None;
    }

    let checkout_session_id = payload.get("checkoutSessionId")?.as_str()?.to_string();
    let invoice_id = payload
        .get("invoiceId")
        .and_then(Value::as_str)
        .unwrap_or(&checkout_session_id)
        .to_string();
    let amount_label = payload
        .get("amountLabel")
        .and_then(Value::as_str)
        .map(str::to_string);
    let selected =
        product_for_amount_minor_units(payload.get("amountMinorUnits").and_then(Value::as_u64));

    Some(ReleasedOrder {
        amount_label,
        cards: released_cards(&checkout_session_id, selected),
        checkout_session_id,
        invoice_id,
    })
}

fn fulfillment_snapshot(state: &AppState) -> Result<FulfillmentSnapshot, ApiError> {
    let fulfillment = state
        .fulfillment
        .lock()
        .map_err(|_| ApiError::internal("fulfillment store is unavailable"))?;
    let latest_release = fulfillment
        .release_order
        .last()
        .and_then(|checkout_session_id| fulfillment.released_orders.get(checkout_session_id))
        .cloned();

    Ok(FulfillmentSnapshot {
        cards: latest_release
            .as_ref()
            .map(|release| release.cards.clone())
            .unwrap_or_default(),
        latest_release,
        released: !fulfillment.released_orders.is_empty(),
        released_count: fulfillment.released_orders.len(),
    })
}

fn released_cards(checkout_session_id: &str, selected: &ProductDefinition) -> Vec<ReleasedCard> {
    let suffix = checkout_suffix(checkout_session_id);

    selected
        .codes
        .iter()
        .enumerate()
        .map(|(index, label)| ReleasedCard {
            label: (*label).to_string(),
            secret: format!("CF-{}-{}", index + 1, suffix),
        })
        .collect()
}

fn checkout_suffix(checkout_session_id: &str) -> String {
    let clean: String = checkout_session_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    let start = clean.len().saturating_sub(8);

    clean[start..].to_ascii_uppercase()
}

fn webhooks(state: &AppState) -> Result<Vec<WebhookReceipt>, ApiError> {
    state
        .webhooks
        .lock()
        .map(|events| events.clone())
        .map_err(|_| ApiError::internal("webhook store is unavailable"))
}

fn verify_webhook_signature(
    config: &Config,
    headers: &HeaderMap,
    payload: &Value,
) -> Result<(), ApiError> {
    let webhook_id = required_header(headers, "x-mermer-webhook-id")?;
    let timestamp = required_header(headers, "x-mermer-webhook-timestamp")?;
    let provided = required_header(headers, "x-mermer-webhook-signature")?;
    let algorithm = required_header(headers, "x-mermer-webhook-algorithm")?;

    if algorithm != "keccak256.secret_prefix.v1" {
        return Err(ApiError::invalid_webhook_signature(
            "Unsupported Mermer Pay webhook signature algorithm.",
        ));
    }

    let canonical_body = serde_json::to_string(payload)
        .map_err(|_| ApiError::internal("webhook payload cannot be canonicalized"))?;
    let signature_base = format!("{webhook_id}.{timestamp}.{canonical_body}");
    let expected = format!(
        "v1={}",
        keyed_digest(&config.webhook_secret, &signature_base)
    );

    if provided != expected {
        return Err(ApiError::invalid_webhook_signature(
            "Mermer Pay webhook signature mismatch.",
        ));
    }

    Ok(())
}

fn header_text(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or(ApiError::invalid_webhook_signature(
            "Mermer Pay webhook signature headers are incomplete.",
        ))
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            origin.as_bytes().starts_with(b"http://127.0.0.1:")
                || origin.as_bytes().starts_with(b"http://localhost:")
        }))
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

fn normalize_optional_wallet_address(value: Option<&str>) -> Result<Option<String>, ApiError> {
    value.map(normalize_wallet_address).transpose()
}

fn normalize_wallet_address(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.len() == 42
        && trimmed.starts_with("0x")
        && trimmed.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Ok(trimmed.to_ascii_lowercase());
    }

    Err(ApiError::bad_request(
        "invalid_wallet_address",
        "CardForge buyer wallet address must be a 20-byte hex address.",
    ))
}

fn is_transaction_hash(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value.as_bytes()[2..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn epoch_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn keyed_digest(secret: &str, message: &str) -> String {
    let digest = keccak256(format!("{secret}.{message}").as_bytes());
    format!("0x{}", lower_hex(&digest))
}

fn lower_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }

    output
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

impl ApiError {
    fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message, None)
    }

    fn project_auth_failed() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "mermer_project_auth_failed",
            "CardForge backend rejected the configured Mermer Pay project API key.",
            None,
        )
    }

    fn upstream_unreachable(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("Mermer Pay API is unreachable: {error}"),
            None,
        )
    }

    async fn upstream_rejected(status: u16, response: reqwest::Response) -> Self {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("Mermer Pay API rejected the checkout with status {status}.")
        } else {
            body
        };

        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    fn bad_upstream_json(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("Mermer Pay API returned an invalid checkout response: {error}"),
            None,
        )
    }

    fn bad_upstream_shape(message: &str) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    fn chain_invoice_unreachable(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            format!("Mermer Pay local chain invoice API is unreachable: {error}"),
            None,
        )
    }

    async fn chain_invoice_rejected(status: u16, response: reqwest::Response) -> Self {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("Mermer Pay local chain invoice API rejected the request with status {status}.")
        } else {
            body
        };

        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            message,
            None,
        )
    }

    fn bad_chain_invoice_json(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            format!("Mermer Pay local chain invoice API returned invalid JSON: {error}"),
            None,
        )
    }

    fn invalid_webhook_signature(message: &str) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "invalid_webhook_signature",
            message,
            None,
        )
    }

    fn internal(message: &str) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            message,
            None,
        )
    }

    fn persistence_failed(error: io::Error) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "local_state_persistence_failed",
            format!("CardForge local order state could not be persisted: {error}"),
            None,
        )
    }

    fn new(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        login_url: Option<String>,
    ) -> Self {
        Self {
            body: ErrorBody {
                code,
                login_url,
                message: message.into(),
            },
            status,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use axum::{
        body::Body,
        extract::Path,
        http::{Request, header},
    };
    use serde_json::json;
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn detects_only_the_cardforge_demo_backend_listener() {
        assert!(is_cardforge_backend_command(
            "/tmp/predict/demo/cardforge/backend/target/debug/cardforge-backend"
        ));
        assert!(is_cardforge_backend_command(
            "target/debug/cardforge-backend"
        ));
        assert!(!is_cardforge_backend_command("node apps/web/server.js"));
        assert!(!is_cardforge_backend_command("target/debug/other-backend"));
    }

    #[test]
    fn parses_lsof_listener_pids_without_trusting_noise() {
        assert_eq!(
            parse_lsof_pids(b"123\n456\nbad\n123\n"),
            vec![123, 456, 123]
        );
    }

    #[tokio::test]
    async fn checkout_uses_project_api_key_and_drops_browser_cookie() {
        let captured = Arc::new(Mutex::new(None::<(String, HeaderMap)>));
        let fake_mermer = fake_mermer_api(captured.clone()).await;
        let state = AppState::new(test_config(
            &fake_mermer,
            "proj_cardforge",
            "mmp_test_secret",
        ));
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders/checkout")
                    .header(header::COOKIE, "mermer_session=must-not-forward")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["checkoutSessionId"], "cs_cardforge");
        assert_eq!(json["chainInvoiceId"], 1001);
        assert_eq!(json["billing"]["platformFeeMinorUnits"], 600000);
        assert_eq!(json["billing"]["merchantNetMinorUnits"], 119400000);

        let (project_id, headers) = captured
            .lock()
            .expect("captured request lock should work")
            .clone()
            .expect("fake Mermer API should receive checkout request");
        assert_eq!(project_id, "proj_cardforge");
        assert_eq!(
            headers
                .get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer mmp_test_secret")
        );
        assert!(headers.get(header::COOKIE).is_none());
        assert!(
            headers
                .get("idempotency-key")
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.starts_with("cardforge-"))
        );
    }

    #[tokio::test]
    async fn checkout_can_forward_zero_based_local_chain_invoice() {
        let captured = Arc::new(Mutex::new(None::<Value>));
        let fake_mermer = fake_mermer_api_with_local_chain(captured.clone()).await;
        let mut config = test_config(&fake_mermer, "proj_cardforge", "mmp_test_secret");
        config.local_chain_invoice_api_url = fake_mermer;
        let state = AppState::new(config);
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders/checkout")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["chainInvoiceId"], 0);

        let payload = captured
            .lock()
            .expect("captured checkout request lock should work")
            .clone()
            .expect("fake Mermer API should receive checkout request");
        assert_eq!(payload["chainInvoiceId"], 0);
        assert_eq!(payload["chainTxHash"], "0xabc");
    }

    #[tokio::test]
    async fn checkout_uses_server_catalog_product_amounts() {
        let captured = Arc::new(Mutex::new(None::<Value>));
        let fake_mermer = fake_mermer_api_with_local_chain(captured.clone()).await;
        let mut config = test_config(&fake_mermer, "proj_cardforge", "mmp_test_secret");
        config.local_chain_invoice_api_url = fake_mermer;
        let state = AppState::new(config);
        let response = app(state)
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders/checkout")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "buyerWalletAddress": "0xcAa3F62150E5813A52c329498dBEfa913B49f2de",
                            "productId": "arena-access"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let payload = captured
            .lock()
            .expect("captured checkout request lock should work")
            .clone()
            .expect("fake Mermer API should receive checkout request");
        assert_eq!(payload["amountMinorUnits"], 80_000_000);
        assert_eq!(payload["amountLabel"], "80 cUSDT");
        assert_eq!(payload["metadata"]["productId"], "arena-access");
        assert_eq!(
            payload["metadata"]
                .as_object()
                .expect("metadata should be an object")
                .len(),
            3
        );
    }

    #[tokio::test]
    async fn webhook_receiver_requires_mermer_signature() {
        let state = AppState::new(test_config(
            "http://127.0.0.1:1",
            "proj_cardforge",
            "mmp_test_secret",
        ));
        let service = app(state);
        let payload = json!({
            "event": "invoice.fulfillment_ready",
            "checkoutSessionId": "cs_cardforge",
            "invoiceId": "cs_cardforge",
            "paymentTruth": "paid",
            "finalityStatus": "finality_safe",
            "amountLabel": "120 cUSDT",
        });
        let webhook_id = "del_cardforge";
        let timestamp = "2026-05-07T04:00:00Z";
        let signature = signed_header("whsec_test", webhook_id, timestamp, &payload);

        let accepted = service
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mermer-pay/webhook")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-mermer-webhook-id", webhook_id)
                    .header("x-mermer-webhook-timestamp", timestamp)
                    .header("x-mermer-webhook-signature", signature)
                    .header("x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);
        let body = axum::body::to_bytes(accepted.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["releaseStatus"], "released");

        let fulfillment = service
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/fulfillment")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(fulfillment.status(), StatusCode::OK);
        let body = axum::body::to_bytes(fulfillment.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["released"], true);
        assert_eq!(json["releasedCount"], 1);
        assert_eq!(json["cards"].as_array().unwrap().len(), 3);

        let rejected = service
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mermer-pay/webhook")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-mermer-webhook-id", webhook_id)
                    .header("x-mermer-webhook-timestamp", timestamp)
                    .header("x-mermer-webhook-signature", "v1=bad")
                    .header("x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn fulfillment_snapshot_uses_release_order() {
        let state = AppState::new(test_config(
            "http://127.0.0.1:1",
            "proj_cardforge",
            "mmp_test_secret",
        ));

        assert!(
            release_from_webhook(
                &state,
                &json!({
                    "event": "invoice.fulfillment_ready",
                    "checkoutSessionId": "cs_z_first",
                    "invoiceId": "cs_z_first",
                    "paymentTruth": "paid",
                    "finalityStatus": "finality_safe"
                }),
            )
            .is_ok()
        );
        assert!(
            release_from_webhook(
                &state,
                &json!({
                    "event": "invoice.fulfillment_ready",
                    "checkoutSessionId": "cs_a_second",
                    "invoiceId": "cs_a_second",
                    "paymentTruth": "paid",
                    "finalityStatus": "finality_safe"
                }),
            )
            .is_ok()
        );

        let snapshot = match fulfillment_snapshot(&state) {
            Ok(snapshot) => snapshot,
            Err(_) => panic!("fulfillment snapshot should be available"),
        };
        assert_eq!(snapshot.released_count, 2);
        assert_eq!(
            snapshot.latest_release.unwrap().checkout_session_id,
            "cs_a_second"
        );
    }

    #[tokio::test]
    async fn wallet_activity_records_owned_cards_after_paid_webhook() {
        let fake_mermer = fake_mermer_api_with_local_chain(Arc::new(Mutex::new(None))).await;
        let mut config = test_config(&fake_mermer, "proj_cardforge", "mmp_test_secret");
        config.local_chain_invoice_api_url = fake_mermer;
        let state = AppState::new(config);
        let service = app(state);
        let wallet = "0xC431773Fbc13B36384077847B884dE5D8dB91618";

        let checkout = service
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/orders/checkout")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "buyerWalletAddress": wallet,
                            "productId": "arena-access"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(checkout.status(), StatusCode::OK);

        let payload = json!({
            "event": "invoice.fulfillment_ready",
            "checkoutSessionId": "cs_cardforge",
            "invoiceId": "cs_cardforge",
            "paymentTruth": "paid",
            "finalityStatus": "finality_safe",
            "amountLabel": "80 cUSDT",
            "amountMinorUnits": 80_000_000,
            "paymentTxHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
            "createdAt": "2026-05-09T05:00:00Z"
        });
        let webhook_id = "del_cardforge_owned";
        let timestamp = "2026-05-09T05:00:00Z";
        let signature = signed_header("whsec_test", webhook_id, timestamp, &payload);
        let accepted = service
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/mermer-pay/webhook")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-mermer-webhook-id", webhook_id)
                    .header("x-mermer-webhook-timestamp", timestamp)
                    .header("x-mermer-webhook-signature", signature)
                    .header("x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);

        let activity = service
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri(&format!("/api/wallets/{wallet}/activity"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(activity.status(), StatusCode::OK);
        let body = axum::body::to_bytes(activity.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["ownedCards"].as_array().unwrap().len(), 1);
        assert_eq!(json["ownedCards"][0]["title"], "Arena Access Card");
        assert_eq!(json["payments"][0]["txHash"], payload["paymentTxHash"]);
    }

    async fn fake_mermer_api(captured: Arc<Mutex<Option<(String, HeaderMap)>>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new()
            .route(
                "/api/dev/local-chain-invoice",
                post(|| async {
                    Json(json!({
                        "chainInvoiceId": 1001,
                        "chainTxHash": "0x01",
                        "expiresAt": 1770000000,
                        "settlementAddress": "0xSettlement"
                    }))
                }),
            )
            .route(
                "/api/projects/{project_id}/checkout-sessions",
                post(move |Path(project_id): Path<String>, headers: HeaderMap| {
                    let captured = captured.clone();
                    async move {
                        *captured.lock().unwrap() = Some((project_id, headers));
                        Json(json!({
                            "checkoutSessionId": "cs_cardforge",
                            "projectId": "proj_cardforge",
                            "environment": "local_dev",
                            "merchantOrderId": "cardforge-order",
                            "idempotencyKey": "cardforge-order",
                            "invoiceId": "cs_cardforge",
                            "chainInvoiceId": 1001,
                            "chainTxHash": "0x01",
                            "checkoutUrl": "http://127.0.0.1:3001/checkout/cs_cardforge",
                            "title": "CardForge prepaid card bundle",
                            "amountLabel": "120 cUSDT",
                            "amountMinorUnits": 120000000,
                            "billing": {
                                "plan": "free",
                                "feeBps": 50,
                                "grossAmountMinorUnits": 120000000,
                                "platformFeeMinorUnits": 600000,
                                "merchantNetMinorUnits": 119400000
                            },
                            "note": "demo",
                            "successUrl": null,
                            "cancelUrl": null,
                            "metadata": {},
                            "status": "open",
                            "createdAt": "2026-05-07T04:00:00Z",
                            "updatedAt": "2026-05-07T04:00:00Z",
                            "expiresAt": "2026-05-07T05:00:00Z"
                        }))
                    }
                }),
            );

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        format!("http://{addr}")
    }

    async fn fake_mermer_api_with_local_chain(captured: Arc<Mutex<Option<Value>>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new()
            .route(
                "/api/dev/local-chain-invoice",
                post(|| async {
                    Json(json!({
                        "chainInvoiceId": 0,
                        "chainTxHash": "0xabc",
                        "expiresAt": 1770000000,
                        "settlementAddress": "0xSettlement"
                    }))
                }),
            )
            .route(
                "/api/projects/{project_id}/checkout-sessions",
                post(move |Json(payload): Json<Value>| {
                    let captured = captured.clone();
                    async move {
                        let gross = payload["amountMinorUnits"].as_u64().unwrap_or(120_000_000);
                        let fee = gross * 25 / 10_000;
                        *captured.lock().unwrap() = Some(payload.clone());
                        Json(json!({
                            "checkoutSessionId": "cs_cardforge",
                            "projectId": "proj_cardforge",
                            "environment": "local_dev",
                            "merchantOrderId": payload["merchantOrderId"],
                            "idempotencyKey": payload["merchantOrderId"],
                            "invoiceId": "cs_cardforge",
                            "chainInvoiceId": payload["chainInvoiceId"],
                            "chainTxHash": payload["chainTxHash"],
                            "checkoutUrl": "http://127.0.0.1:3001/checkout/cs_cardforge",
                            "title": payload["title"],
                            "amountLabel": payload["amountLabel"],
                            "amountMinorUnits": gross,
                            "billing": {
                                "plan": "growth",
                                "feeBps": 25,
                                "grossAmountMinorUnits": gross,
                                "platformFeeMinorUnits": fee,
                                "merchantNetMinorUnits": gross - fee
                            },
                            "note": "demo",
                            "successUrl": null,
                            "cancelUrl": null,
                            "metadata": {},
                            "status": "open",
                            "createdAt": "2026-05-07T04:00:00Z",
                            "updatedAt": "2026-05-07T04:00:00Z",
                            "expiresAt": "2026-05-07T05:00:00Z"
                        }))
                    }
                }),
            );

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        format!("http://{addr}")
    }

    fn test_config(api_url: &str, project_id: &str, api_key: &str) -> Config {
        Config {
            bind_addr: "127.0.0.1:0".parse().unwrap(),
            data_path: std::env::temp_dir()
                .join(format!("cardforge-test-{}.json", Uuid::new_v4().simple())),
            login_url: "http://127.0.0.1:3001/login".to_string(),
            local_chain_invoice_api_url: api_url.to_string(),
            mermer_api_url: api_url.to_string(),
            mermer_console_url: "http://127.0.0.1:3001/merchant".to_string(),
            project_api_key: api_key.to_string(),
            merchant_label: "CardForge Demo Store".to_string(),
            project_id: project_id.to_string(),
            webhook_endpoint: "http://127.0.0.1:8092/api/mermer-pay/webhook".to_string(),
            webhook_secret: "whsec_test".to_string(),
        }
    }

    fn signed_header(secret: &str, webhook_id: &str, timestamp: &str, payload: &Value) -> String {
        let canonical_body = serde_json::to_string(payload).unwrap();
        let base = format!("{webhook_id}.{timestamp}.{canonical_body}");
        format!("v1={}", keyed_digest(secret, &base))
    }
}
