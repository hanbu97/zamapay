mod auth;
mod client;
mod common;
mod config;
mod control_ops;
mod merchant_ops;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Parser, Subcommand, ValueEnum};
use shared::{BillingPlan, PaymentRail, ProjectEnvironmentKind};

pub use common::{init_env_bundle, parse_metadata};

#[derive(Debug, Parser)]
#[command(
    name = "zamapay",
    version,
    about = "ZamaPay merchant control-plane CLI."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Sign in with an EVM private key and store a local control session.
    Login(LoginArgs),
    /// Clear the stored local control session.
    Logout(ControlArgs),
    /// Show the active merchant identity.
    Whoami(ControlArgs),
    /// Show API, login, and linked project state.
    Status(StatusArgs),
    /// Print or write the minimal merchant server env bundle.
    Init(InitArgs),
    /// Check local CLI, API, and project-secret readiness.
    Doctor(DoctorArgs),
    /// Manage merchant projects.
    Project(ProjectArgs),
    /// Enable, disable, or list project payment rails.
    Rail(RailArgs),
    /// Create, list, or revoke project server secrets.
    Secret(SecretArgs),
    /// Manage webhook endpoints and delivery tests.
    Webhook(WebhookArgs),
    /// Create, list, or inspect hosted checkout sessions.
    Checkout(CheckoutArgs),
    /// List or resend webhook deliveries.
    Delivery(DeliveryArgs),
    /// List webhook events.
    Event(EventArgs),
    /// List supported EVM assets.
    Assets(AssetsArgs),
    /// List project balances.
    Balance(BalanceArgs),
    /// Project a confirmed withdrawal after the chain transaction exists.
    Withdraw(WithdrawArgs),
    /// Verify a ZamaPay webhook signature against raw bytes.
    VerifyWebhook(VerifyWebhookArgs),
    /// Send a signed webhook.test payload to a merchant receiver.
    TestWebhook(TestWebhookArgs),
}

#[derive(Debug, Args, Clone)]
pub struct ControlArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_CONTROL_SESSION")]
    pub session_id: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args, Clone)]
pub struct ProjectScopedArgs {
    #[command(flatten)]
    pub control: ControlArgs,
    #[arg(long, env = "ZAMAPAY_PROJECT_ID")]
    pub project_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct LoginArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_OWNER_PRIVATE_KEY")]
    pub private_key: Option<String>,
    #[arg(long)]
    pub private_key_stdin: bool,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct StatusArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct InitArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_SECRET_KEY")]
    pub secret_key: Option<String>,
    #[arg(long)]
    pub write_env: Option<PathBuf>,
    #[arg(long)]
    pub force: bool,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct DoctorArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_SECRET_KEY")]
    pub secret_key: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ProjectArgs {
    #[command(subcommand)]
    pub command: ProjectCommand,
}

#[derive(Debug, Subcommand)]
pub enum ProjectCommand {
    List(ControlArgs),
    Create(ProjectCreateArgs),
    Show(ProjectScopedArgs),
    Link(ProjectLinkArgs),
    Unlink(ControlArgs),
}

#[derive(Debug, Args)]
pub struct ProjectCreateArgs {
    #[command(flatten)]
    pub control: ControlArgs,
    #[arg(long)]
    pub name: String,
    #[arg(long, value_enum, default_value = "local_dev")]
    pub environment: EnvArg,
    #[arg(long, value_enum)]
    pub billing_plan: Option<BillingPlanArg>,
    #[arg(long)]
    pub webhook_url: Option<String>,
    #[arg(long)]
    pub link: bool,
    #[arg(long)]
    pub create_secret: bool,
    #[arg(long)]
    pub secret_label: Option<String>,
}

#[derive(Debug, Args)]
pub struct ProjectLinkArgs {
    #[command(flatten)]
    pub control: ControlArgs,
    #[arg(long, env = "ZAMAPAY_PROJECT_ID")]
    pub project_id: String,
}

#[derive(Debug, Args)]
pub struct RailArgs {
    #[command(subcommand)]
    pub command: RailCommand,
}

#[derive(Debug, Subcommand)]
pub enum RailCommand {
    List(ProjectScopedArgs),
    Enable(RailSetArgs),
    Disable(RailSetArgs),
}

#[derive(Debug, Args)]
pub struct RailSetArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long, value_enum)]
    pub payment_rail: RailArg,
}

#[derive(Debug, Args)]
pub struct SecretArgs {
    #[command(subcommand)]
    pub command: SecretCommand,
}

#[derive(Debug, Subcommand)]
pub enum SecretCommand {
    List(ProjectScopedArgs),
    Create(SecretCreateArgs),
    Revoke(SecretRevokeArgs),
}

#[derive(Debug, Args)]
pub struct SecretCreateArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub label: Option<String>,
    #[arg(long, value_enum)]
    pub environment: Option<EnvArg>,
    #[arg(long)]
    pub export_env: bool,
}

#[derive(Debug, Args)]
pub struct SecretRevokeArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub key_id: String,
    #[arg(long)]
    pub yes: bool,
}

#[derive(Debug, Args)]
pub struct WebhookArgs {
    #[command(subcommand)]
    pub command: WebhookCommand,
}

#[derive(Debug, Subcommand)]
pub enum WebhookCommand {
    List(ProjectScopedArgs),
    Create(WebhookCreateArgs),
    Update(WebhookUpdateArgs),
    Test(WebhookTestArgs),
    RotateSecret(WebhookRotateSecretArgs),
}

#[derive(Debug, Args)]
pub struct WebhookCreateArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub url: String,
    #[arg(long, value_enum)]
    pub environment: Option<EnvArg>,
    #[arg(long)]
    pub export_env: bool,
}

#[derive(Debug, Args)]
pub struct WebhookUpdateArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub endpoint_id: String,
    #[arg(long)]
    pub url: String,
    #[arg(long, value_enum)]
    pub environment: Option<EnvArg>,
    #[arg(long)]
    pub disabled: bool,
}

#[derive(Debug, Args)]
pub struct WebhookTestArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub endpoint_id: String,
}

#[derive(Debug, Args)]
pub struct WebhookRotateSecretArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub endpoint_id: String,
    #[arg(long)]
    pub yes: bool,
    #[arg(long)]
    pub export_env: bool,
}

#[derive(Debug, Args)]
pub struct CheckoutArgs {
    #[command(subcommand)]
    pub command: CheckoutCommand,
}

#[derive(Debug, Subcommand)]
pub enum CheckoutCommand {
    Create(CreateCheckoutArgs),
    List(ProjectScopedArgs),
    Show(CheckoutShowArgs),
    Quote(CheckoutQuoteArgs),
}

#[derive(Debug, Args)]
pub struct CreateCheckoutArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_SECRET_KEY")]
    pub secret_key: String,
    #[arg(long, env = "ZAMAPAY_PROJECT_ID")]
    pub project_id: Option<String>,
    #[arg(long, value_enum)]
    pub payment_rail: RailArg,
    #[arg(long)]
    pub merchant_order_id: String,
    #[arg(long)]
    pub title: String,
    #[arg(long)]
    pub amount_label: String,
    #[arg(long)]
    pub amount_minor_units: u64,
    #[arg(long, default_value = "")]
    pub note: String,
    #[arg(long)]
    pub success_url: Option<String>,
    #[arg(long)]
    pub cancel_url: Option<String>,
    #[arg(long)]
    pub evm_chain_id: Option<u64>,
    #[arg(long)]
    pub evm_token_symbol: Option<String>,
    #[arg(long)]
    pub chain_invoice_id: Option<u64>,
    #[arg(long)]
    pub chain_tx_hash: Option<String>,
    #[arg(long = "metadata")]
    pub metadata: Vec<String>,
    #[arg(long)]
    pub idempotency_key: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct CheckoutShowArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub checkout_session_id: String,
}

#[derive(Debug, Args)]
pub struct CheckoutQuoteArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long, env = "ZAMAPAY_SECRET_KEY")]
    pub secret_key: String,
    #[arg(long, env = "ZAMAPAY_PROJECT_ID")]
    pub project_id: Option<String>,
    #[arg(long)]
    pub amount_minor_units: u64,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct DeliveryArgs {
    #[command(subcommand)]
    pub command: DeliveryCommand,
}

#[derive(Debug, Subcommand)]
pub enum DeliveryCommand {
    List(ProjectScopedArgs),
    Resend(DeliveryResendArgs),
}

#[derive(Debug, Args)]
pub struct DeliveryResendArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub delivery_id: String,
    #[arg(long)]
    pub yes: bool,
}

#[derive(Debug, Args)]
pub struct EventArgs {
    #[command(subcommand)]
    pub command: EventCommand,
}

#[derive(Debug, Subcommand)]
pub enum EventCommand {
    List(ProjectScopedArgs),
}

#[derive(Debug, Args)]
pub struct AssetsArgs {
    #[arg(long, env = "ZAMAPAY_API_URL")]
    pub api_url: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct BalanceArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
}

#[derive(Debug, Args)]
pub struct WithdrawArgs {
    #[command(flatten)]
    pub scope: ProjectScopedArgs,
    #[arg(long)]
    pub amount_minor_units: u64,
    #[arg(long)]
    pub chain_tx_hash: String,
    #[arg(long)]
    pub chain_id: Option<u64>,
    #[arg(long)]
    pub token_contract: Option<String>,
    #[arg(long)]
    pub settlement_contract: Option<String>,
    #[arg(long)]
    pub recipient_address: Option<String>,
    #[arg(long)]
    pub yes: bool,
}

#[derive(Debug, Args)]
pub struct VerifyWebhookArgs {
    #[arg(long, env = "ZAMAPAY_WEBHOOK_SECRET")]
    pub secret: String,
    #[arg(long)]
    pub body: Option<String>,
    #[arg(long)]
    pub body_file: Option<PathBuf>,
    #[arg(long = "svix-id")]
    pub svix_id: String,
    #[arg(long = "svix-timestamp")]
    pub svix_timestamp: String,
    #[arg(long = "svix-signature")]
    pub svix_signature: String,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct TestWebhookArgs {
    #[arg(long)]
    pub url: String,
    #[arg(long, env = "ZAMAPAY_WEBHOOK_SECRET")]
    pub secret: String,
    #[arg(long)]
    pub body: Option<String>,
    #[arg(long)]
    pub body_file: Option<PathBuf>,
    #[arg(long)]
    pub message_id: Option<String>,
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum RailArg {
    #[value(name = "zama_private")]
    ZamaPrivate,
    #[value(name = "evm_erc20")]
    EvmErc20,
}

impl RailArg {
    pub(crate) fn payment_rail(self) -> PaymentRail {
        match self {
            Self::ZamaPrivate => PaymentRail::ZamaPrivate,
            Self::EvmErc20 => PaymentRail::EvmErc20,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        self.payment_rail().as_str()
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum EnvArg {
    #[value(name = "local_dev")]
    LocalDev,
    #[value(name = "sepolia")]
    Sepolia,
}

impl EnvArg {
    pub(crate) fn kind(self) -> ProjectEnvironmentKind {
        match self {
            Self::LocalDev => ProjectEnvironmentKind::LocalDev,
            Self::Sepolia => ProjectEnvironmentKind::Sepolia,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum BillingPlanArg {
    Free,
    Growth,
    Enterprise,
}

impl BillingPlanArg {
    pub(crate) fn plan(self) -> BillingPlan {
        match self {
            Self::Free => BillingPlan::Free,
            Self::Growth => BillingPlan::Growth,
            Self::Enterprise => BillingPlan::Enterprise,
        }
    }
}

pub async fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Login(args) => control_ops::login(args).await,
        Command::Logout(args) => control_ops::logout(args).await,
        Command::Whoami(args) => control_ops::whoami(args).await,
        Command::Status(args) => control_ops::status(args).await,
        Command::Init(args) => control_ops::init(args).await,
        Command::Doctor(args) => control_ops::doctor(args).await,
        Command::Project(args) => control_ops::project(args).await,
        Command::Rail(args) => control_ops::rail(args).await,
        Command::Secret(args) => control_ops::secret(args).await,
        Command::Webhook(args) => merchant_ops::webhook(args).await,
        Command::Checkout(args) => merchant_ops::checkout(args).await,
        Command::Delivery(args) => merchant_ops::delivery(args).await,
        Command::Event(args) => merchant_ops::event(args).await,
        Command::Assets(args) => merchant_ops::assets(args).await,
        Command::Balance(args) => merchant_ops::balance(args).await,
        Command::Withdraw(args) => merchant_ops::withdraw(args).await,
        Command::VerifyWebhook(args) => merchant_ops::verify_webhook(args),
        Command::TestWebhook(args) => merchant_ops::test_webhook(args).await,
    }
}
