use anyhow::Result;
use clap::Parser;
use zamapay_cli::{Cli, run};

#[tokio::main]
async fn main() -> Result<()> {
    run(Cli::parse()).await
}
