# ZamaPay

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
npm run reset:local-dev
cargo run -p api
```

```bash
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

Set `DATABASE_URL=postgres://zamapay:zamapay@127.0.0.1:5432/zamapay` before starting the API. Projects, API keys, checkout sessions, payment projections, subscriptions, webhook state, and withdrawal read models use normalized Postgres tables as the single portal source of truth.

Use `npm run reset:local-dev` after every Hardhat Local reset, before starting the API and CardForge backend. It recreates both local databases, `zamapay` and `cardforge`, before redeploying contracts so chain ids, invoice ids, balances, and fulfillment records stay aligned.

CardForge is a separate merchant demo and uses its own database URL:
`CARDFORGE_DATABASE_URL=postgres://zamapay:zamapay@127.0.0.1:5432/cardforge`.
Fresh Docker volumes create both `zamapay` and `cardforge`; for an existing volume, run
`docker exec zamapay-postgres createdb -U zamapay cardforge` once if the CardForge database is missing.

Open:

- `http://127.0.0.1:3001/dashboard`
- `http://127.0.0.1:3001/ops`
- `http://127.0.0.1:3001/merchant`

Standalone merchant templates live under `demo/` and are launched from their own directories. The ZamaPay root scripts do not start, build, or lint template projects.

Run the full local readiness gate after API, web, and Hardhat are running:

```bash
npm run verify:local
```

This checks the local manifest, Rust API, Next pages, browser projection route, and hosted checkout rendering.
It also signs a Rust auth nonce with `ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY`, proves that the resulting `zamapay_session` cookie can render the protected dashboard, and verifies the local browser signer route is disabled unless explicitly enabled.
For manual browser-only `LoginCard` verification without a wallet extension, temporarily start the web server with `ZAMAPAY_ENABLE_DEV_SIGNER=1`; leave it disabled for normal local runs and future public-testnet runs.

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
