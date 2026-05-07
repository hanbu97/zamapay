# Mermer Pay

Confidential merchant checkout for wallet-authenticated merchants, Zama FHEVM settlement, and finality-gated webhook release.

## What Is Implemented

- Rust API: nonce login, cookie sessions, dashboard read model, invoice APIs, operator projection, finality, and fulfillment release.
- Next.js web app: shadcn merchant homepage, wallet login, dashboard, hosted checkout, and operator diagnostics.
- Contracts: merchant registry, confidential token mock, confidential invoice settlement, local deploy, Sepolia deploy, tests, and smoke scripts.
- Generated clients: ABI and address manifests flow from Hardhat into `generated/*` for Rust and web.

## Local Platform

Run these in separate terminals from the repo root.

```bash
npm install
npm --workspace contracts run node
```

```bash
npm --workspace contracts run deploy:localhost
cargo run -p api
```

```bash
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

Set `MERMER_PORTAL_STORE_PATH=tmp/mermer-portal-store.json` before starting the API when you want created invoices and payment projections to survive an API restart.

Open:

- `http://127.0.0.1:3001/dashboard`
- `http://127.0.0.1:3001/ops`
- `http://127.0.0.1:3001/merchant`

Standalone merchant templates live under `demo/` and are launched from their own directories. The Mermer Pay root scripts do not start, build, or lint template projects.

Run the deterministic local payment proof:

```bash
npm run smoke:local-invoice
```

This proves merchant login, chain invoice creation, confidential token mint, encrypted approval, encrypted payment, public decrypt, `finalizePayment`, Rust projection, finality-safe state, and webhook release readiness.

Run the full local readiness gate after API, web, and Hardhat are running:

```bash
npm run verify:local
```

This additionally checks the local manifest, Rust API, Next pages, browser projection route, and hosted checkout rendering.
It also signs a Rust auth nonce with `MERMER_LOCAL_LOGIN_PRIVATE_KEY`, proves that the resulting `mermer_session` cookie can render the protected dashboard, and verifies the local browser signer route is disabled unless explicitly enabled.
For manual browser-only `LoginCard` verification without a wallet extension, temporarily start the web server with `MERMER_ENABLE_DEV_SIGNER=1`; leave it disabled for normal local runs and every Sepolia run.

## Sepolia Handoff

Public Zama/Sepolia constants are documented in `docs/runbooks/testnet-config.md`; wallet-owned values still have to come from funded Sepolia wallets.

Create a local env file from `.env.example`, then set a real Sepolia RPC and a funded deployer key:

```bash
cp .env.example .env
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export DEPLOYER_PRIVATE_KEY=0x...
export MERMER_OPERATOR_KEY=replace-with-a-long-random-operator-key
export MERMER_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export MERMER_GATEWAY_CALLBACK_KEY=replace-with-a-long-random-gateway-callback-key
export NEXT_PUBLIC_CONTRACT_ENV=sepolia
export BUYER_ADDRESS=0x...
```

Hardhat scripts load the repo-root `.env` directly. Shell exports still win when you want to override a value for one command.

The current workspace already has funded throwaway Sepolia wallets in `.env`, a deployed manifest, and buyer test USD. For a fresh funded environment, run the one-command public-testnet handoff:

```bash
npm run sepolia:handoff
```

This preflights Sepolia funding and secrets, deploys only when the Sepolia manifest is missing, mints buyer test USD, and reruns `verify:sepolia`.

Manual deploy and verify:

```bash
npm run deploy:sepolia
npm run verify:sepolia
```

Mint confidential test USD to the buyer wallet before checkout payment:

```bash
BUYER_ADDRESS=0x... AMOUNT_MINOR_UNITS=1000000000 npm run mint:test-usd:sepolia
```

Start API and web, then run the browser flow:

```bash
cargo run -p api
NEXT_PUBLIC_CONTRACT_ENV=sepolia npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

Browser path:

```text
Mermer Pay login/project config -> merchant backend creates checkout -> Mermer Pay hosted checkout -> approve encrypted token -> pay confidentially -> public decrypt -> finalizePayment -> server verifies InvoicePaid -> Rust projection -> webhook/release boundary
```

The checkout calls the server projection route after `finalizePayment`. If a run needs manual recovery, use the finalization hash:

```bash
PAYMENT_TX_HASH=0x... npm run project:payment:sepolia
```

Refresh `/checkout/{invoiceId}`. Release state becomes safe once payment and finality agree.

Operator diagnostics live at `/ops`. Local runs may use default operator/gateway secrets, but Sepolia diagnostics and decrypt callbacks require non-default `MERMER_OPERATOR_KEY`, `MERMER_WEBHOOK_SECRET`, and `MERMER_GATEWAY_CALLBACK_KEY`.
Merchant settlement decrypt lives under the dashboard `Decrypt` tab. It stays disabled on local-dev and uses wallet-authorized Zama user decrypt on Sepolia.

## Verification Commands

```bash
npm run verify:local:full
```

For individual gates:

```bash
npm run test:web
npm run lint:web
npm run build:web
cargo fmt --all --check
cargo test --workspace
npm run test:contracts
npm run verify:local
npm run verify:sepolia
```

`verify:sepolia` is expected to fail until `DEPLOYER_PRIVATE_KEY`, `BUYER_ADDRESS`, non-default server secrets, `NEXT_PUBLIC_CONTRACT_ENV=sepolia`, and `generated/contracts/addresses/sepolia.json` are all present and valid. The current ignored `.env` already fills the public Sepolia config plus non-default server secrets; funded deployer and buyer wallet values remain wallet-owned.
In this workspace, `verify:sepolia` currently passes against deployed Sepolia contracts and Rust-served manifest.
