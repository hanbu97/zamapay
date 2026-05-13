# ZamaPay

Confidential merchant checkout for wallet-authenticated merchants, Zama FHEVM settlement, and finality-gated webhook release.

## What Is Implemented

- Rust API: nonce login, cookie sessions, dashboard read model, invoice APIs, chain projection, finality, and fulfillment release.
- Next.js web app: shadcn merchant homepage, wallet login, dashboard, hosted checkout, and operator diagnostics.
- Contracts: merchant registry, official-style confidential token mock, private checkout settlement, local deploy, tests, and smoke scripts.
- Generated clients: ABI and address manifests flow from Hardhat into `generated/*` for Rust and web.

## Local Platform

Tooling is pinned by `.mise.toml` for Node and `just`; Rust is intentionally not managed there because this workspace already uses the newly upgraded Rust toolchain.

```bash
mise trust
mise install
mise exec -- just --list
mise exec -- just setup
```

The `Justfile` is the human entrypoint. It delegates to `env/`, `scripts/`, `npm`, `cargo`, and Hardhat instead of duplicating chain ids, URLs, finality, or secrets.

Run these in separate terminals from the repo root.

```bash
just db-up
just contracts-node
```

```bash
just reset-local
just api-local
```

```bash
just web-local
```

Service environment contracts live under `env/`. Files ending in `.env.example` are safe templates; same-name `.env` files contain local secrets and are ignored by git. Projects, API keys, checkout sessions, payment projections, subscriptions, webhook state, and withdrawal read models use normalized Postgres tables as the single portal source of truth.

Use `just reset-local` after every Hardhat Local reset, before starting the API, web app, and CardForge backend. It recreates both local databases, `zamapay` and `cardforge`, redeploys contracts, refreshes generated clients, and clears local Next/Turbopack caches so chain ids, invoice ids, balances, fulfillment records, and CSS variables stay aligned.

If a local browser page looks stale after branch churn, env changes, or a design-token rename, run:

```bash
just clean-local-dev
```

The local and Sepolia `just *web*local*` recipes already clear their own `.next` caches before starting.

CardForge is a separate merchant demo and uses its own database URL:
`CARDFORGE_DATABASE_URL=postgres://zamapay:zamapay@127.0.0.1:5432/cardforge`.
Fresh Docker volumes create both `zamapay` and `cardforge`; for an existing volume, run
`docker exec zamapay-postgres createdb -U zamapay cardforge` once if the CardForge database is missing.

For a Supabase-backed local run, let the recipe compose local-dev first and the Supabase override second:

```bash
just api-supabase-local
```

Open:

- `http://127.0.0.1:3001/dashboard`
- `http://127.0.0.1:3001/ops`
- `http://127.0.0.1:3001/merchant`

Standalone merchant templates live under `demo/` and are launched from their own directories. The ZamaPay root scripts do not start, build, or lint template projects.

Run the full local readiness gate after API, web, and Hardhat are running:

```bash
just verify-local
```

This checks the local manifest, Rust API, Next pages, browser projection route, and hosted checkout rendering.
It also signs a Rust auth nonce with `ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY`, proves that the resulting `zamapay_session` cookie can render the protected dashboard, and verifies the local browser signer route is disabled unless explicitly enabled.
For manual browser-only `LoginCard` verification without a wallet extension, temporarily start the web server with `ZAMAPAY_ENABLE_DEV_SIGNER=1`; leave it disabled for normal local runs and future public-testnet runs.

## Public Testnet

Public-testnet work is guarded by explicit runtime profiles and env files. The active local MVP remains Hardhat/FHEVM mock RPC, `ConfidentialUSDMock.claimTestTokens()` from the browser wallet, direct buyer-wallet payment, encrypted pending buckets, merchant-signed withdraw, and local chain evidence projection after finalization.

Sepolia local-UI and preview setup lives in `env/README.md`. Use these entrypoints instead of hand-sourcing env stacks:

```bash
just verify-runtime sepolia-local-ui
just deploy-sepolia-contracts
just api-sepolia-local-ui
just web-sepolia-local-ui
just cardforge-api-sepolia-local-ui
just cardforge-web-sepolia-local-ui
```

Before a public preview deploy, run:

```bash
just preview-check
```

## Verification Commands

```bash
just verify-full
```

For individual gates:

```bash
just check
just build-web
just verify-local
```

`just check` starts or reuses local Postgres because Rust integration tests need a database URL.
