use std::str::FromStr;

use anyhow::{Context, Result, bail};
use ethers_signers::{LocalWallet, Signer};
use shared::{SessionResponse, VerifyRequest};

use crate::client::ApiClient;

pub async fn login_with_private_key(
    client: &ApiClient,
    private_key: &str,
) -> Result<SessionResponse> {
    let wallet = LocalWallet::from_str(private_key.trim())
        .context("failed to parse private key; expected a 32-byte EVM private key")?;
    let address = format!("{:?}", wallet.address());
    let challenge = client.auth_nonce(&address).await?;
    let signature = wallet
        .sign_message(challenge.message.as_bytes())
        .await
        .context("failed to sign ZamaPay login challenge")?;
    let response = client
        .auth_verify(&VerifyRequest {
            address,
            nonce: challenge.nonce,
            message: challenge.message,
            signature: signature.to_string(),
        })
        .await?;
    if !response.authenticated || response.user.is_none() {
        bail!("ZamaPay API did not return an authenticated session");
    }
    Ok(response)
}
