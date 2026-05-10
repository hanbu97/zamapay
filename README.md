# Mermer Pay

Confidential merchant checkout for wallet-authenticated merchants, Zama FHEVM settlement, and finality-gated webhook release.

## What Is Implemented

- Rust API: nonce login, cookie sessions, dashboard read model, invoice APIs, chain projection, finality, and fulfillment release.
- Next.js web app: shadcn merchant homepage, wallet login, dashboard, hosted checkout, and operator diagnostics.
- Contracts: merchant registry, official-style confidential token mock, private checkout settlement, local deploy, tests, and smoke scripts.
- Generated clients: ABI and address manifests flow from Hardhat into `generated/*` for Rust and web.

## Local Platform

Run these in separate terminals from the repo root.

```bash
npm install
docker compose up -d postgres
npm --workspace contracts run node
```

```bash
npm --workspace contracts run deploy:localhost
cargo run -p api
```

```bash
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

Set `DATABASE_URL=postgres://mermer:mermer@127.0.0.1:5432/mermer` before starting the API. Projects, API keys, checkout sessions, payment projections, subscriptions, webhook state, and withdrawal read models use normalized Postgres tables as the single portal source of truth.

CardForge is a separate merchant demo and uses its own database URL:
`CARDFORGE_DATABASE_URL=postgres://mermer:mermer@127.0.0.1:5432/cardforge`.
Fresh Docker volumes create both `mermer` and `cardforge`; for an existing volume, run
`docker exec mermer-postgres createdb -U mermer cardforge` once if the CardForge database is missing.

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
For manual browser-only `LoginCard` verification without a wallet extension, temporarily start the web server with `MERMER_ENABLE_DEV_SIGNER=1`; leave it disabled for normal local runs and future public-testnet runs.

## Public Testnet

Public-testnet support is paused in this workspace. The active MVP is local-dev only: Hardhat/FHEVM mock RPC, `ConfidentialUSDMock.claimTestTokens()` from the browser wallet, direct buyer-wallet payment, encrypted pending buckets, merchant-signed withdraw, and local chain evidence projection after finalization.

Future Sepolia work should be reintroduced as one clean branch through Zama official relayer/gateway surfaces and an explicit protocol-fee funding policy. Do not revive the old Sepolia scripts, transparent settlement fallback, or owner-mint helper as active paths.

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
```
