# Sepolia Demo Rail

## Purpose

Deploy Mermer Pay contracts to Sepolia, expose the `sepolia` manifest through Rust, and unlock browser-side Zama relayer checkout payment.

## Prerequisites

Public testnet constants are captured in `docs/runbooks/testnet-config.md`. The app uses Zama's `SepoliaConfig`, with host chain id `11155111`, gateway chain id `10901`, and relayer URL `https://relayer.testnet.zama.org`.

```bash
cp .env.example .env
export SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
export DEPLOYER_PRIVATE_KEY="0x..."
export MERMER_OPERATOR_KEY="replace-with-a-long-random-operator-key"
export MERMER_WEBHOOK_SECRET="replace-with-a-long-random-webhook-secret"
export MERMER_GATEWAY_CALLBACK_KEY="replace-with-a-long-random-gateway-callback-key"
export NEXT_PUBLIC_CONTRACT_ENV=sepolia
export BUYER_ADDRESS="0x..."
```

The deployer wallet needs Sepolia ETH. Do not use local Hardhat private keys, local default buyer addresses, the local operator key, the local webhook secret, or the local gateway callback key on any public network; `verify:sepolia` rejects known public local-test addresses, `local-operator-dev-key`, `local-webhook-dev-secret`, and `local-zama-gateway-dev-key`.
Hardhat scripts load the repo-root `.env`; shell exports override file values for the current command.

The buyer wallet needs Sepolia ETH plus a confidential test-USD balance minted by the deployed `ConfidentialUSDMock` owner before checkout payment can succeed.
Browser checkout creation and payment both ask the injected wallet to switch to Sepolia before signing any contract write.

Browser faucet status from this workspace:

- ETHGlobal Sepolia faucet opens but requires login.
- Google Cloud Sepolia faucet funded both demo wallets after user login.
- Sepolia PoW faucet opens, but the current environment is blocked as a hosting IP range after submitting the deployer address.

The current demo wallets are funded and `verify:sepolia` passes.

## Current Sepolia Deployment

```text
MerchantRegistry:              0xD3E6345A856a4339effe3cf128745db2CAa4D2d1
ConfidentialUSDMock:           0x473FBc0B9761F1E879c22971D9b77134f03C42bE
ConfidentialInvoiceSettlement: 0x6975Bba2F12F47a49028120C6c51fBc9D2Fd6015
Buyer:                         0xC431773Fbc13B36384077847B884dE5D8dB91618
Buyer test-USD mint tx:        0x5c7838ce7a110e687cdc282cd7e50c50aa06cdf89871cf29bc649644dd6d0483
```

## Steps

1. Deploy contracts and write `generated/contracts/addresses/sepolia.json`:

```bash
npm --workspace contracts run deploy:sepolia
```

2. Confirm the Sepolia deployment and browser-demo environment are internally consistent:

```bash
npm --workspace contracts run verify:sepolia
```

3. Mint confidential test USD to the buyer wallet:

```bash
AMOUNT_MINOR_UNITS=1000000000 npm --workspace contracts run mint:test-usd:sepolia
```

The default amount is `1000000000` minor units. Override it only when the demo invoice amount changes.

4. Confirm Rust can serve the Sepolia manifest:

```bash
cargo run -p api
curl http://127.0.0.1:8080/api/contracts/sepolia
```

5. Start the web app against the Sepolia manifest:

```bash
NEXT_PUBLIC_CONTRACT_ENV=sepolia npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

6. Exercise the browser payment flow:

```text
Mermer Pay login/project config -> CardForge standalone app or /dashboard -> create checkout with amount -> /checkout/{invoiceId} -> buyer wallet approves confidential token -> buyer wallet pays confidentially -> relayer public decrypt -> finalize payment -> server verifies InvoicePaid -> Rust projection
```

7. Confirm the checkout auto-projected the finalized payment.

Refresh `/checkout/{invoiceId}` after `Finalization transaction` appears; fulfillment artifacts should be visible once the server projection route advances finality.

If manual recovery is needed, project the finalized payment into Rust and advance demo finality:

```bash
PAYMENT_TX_HASH=0x... npm --workspace contracts run project:payment:sepolia
```

Use the `Finalization transaction` hash shown on the checkout page.

## Acceptance

- `generated/contracts/addresses/sepolia.json` contains non-null contract addresses and `chainId: 11155111`.
- `npm --workspace contracts run verify:sepolia` passes: RPC, deployer signer, non-public deployer key, deployer balance, non-default operator key, non-default webhook secret, non-default gateway callback key, `NEXT_PUBLIC_CONTRACT_ENV=sepolia`, non-public buyer address, buyer gas balance, mint amount, manifest, contract bytecode, and Rust-served manifest agree.
- `BUYER_ADDRESS=... npm --workspace contracts run mint:test-usd:sepolia` succeeds and returns a mint tx hash for `ConfidentialUSDMock`.
- `/api/contracts/sepolia` returns the same manifest.
- `demo/cardforge` can create a CardForge hosted checkout through configured Mermer Pay API/checkout URLs after merchant login.
- Checkout shows the invoice minor-unit amount and `Sepolia encrypted payment ready` for a chain-projected pending invoice.
- Buyer payment submits encrypted token approval, encrypted settlement payment, public-decrypts the returned payment-check handle, then submits `finalizePayment`.
- `/api/checkout/project-finalized-payment` verifies the finalization tx emitted `InvoicePaid` from the current settlement contract, then advances the invoice to paid and finality-safe before fulfillment releases artifacts.
- `PAYMENT_TX_HASH=... npm --workspace contracts run project:payment:sepolia` remains a manual fallback.
