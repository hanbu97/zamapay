# Scripts Architecture

## Tree

```text
scripts
|-- postgres-init/
|   `-- 01-cardforge.sql
|-- evm-erc20-indexer.mjs
|-- local-evm-erc20-verify.mjs
|-- local-full-verify.js
|-- local-readiness.js
|-- reset-local-dev.js
|-- run-rust-tests.sh
|-- run-with-env.sh
|-- runtime-profile.js
|-- seed-cardforge-local-project.js
|-- sdk-local-smoke.mjs
|-- sync-cardforge-frontend-generated.js
`-- verify-runtime-profile.js
```

## Decisions

- Root scripts implement cross-package local-dev readiness; `Justfile` is the supported human-facing and agent-facing workflow entrypoint.
- Agents should call `just` recipes for repeatable setup, reset, service startup, deployment, and verification. Call scripts directly only while debugging script internals or wiring a new recipe.
- Package-local contract tasks stay in `contracts/scripts`.
- `run-rust-tests.sh` runs Rust workspace tests with a clean test env, the database URL from local-dev env, local-dev runtime profile, a test-only webhook secret encryption key, and serial test threads by default so Postgres-backed tests do not deadlock.
- `run-with-env.sh` is the tiny process launcher used by `Justfile`; it sources one or more service env files, exports them, then `exec`s the target command.
- `runtime-profile.js` is the Node reader for `env/runtime-profiles.json`; scripts must use it instead of repeating URL, RPC, chain id, or finality defaults.
- `evm-erc20-indexer.mjs` is the ordinary EVM rail worker; it polls `EvmCheckoutSettlement.EvmPaymentAccepted` logs for watchlisted settlement contracts, posts block-hash-backed settlement projections, and advances backend-owned scan cursors with a reorg window.
- `local-evm-erc20-verify.mjs` is the local ordinary ERC20 rail acceptance proof; it creates a project secret and checkout, verifies the hosted checkout route, approves exact local ERC20, pays through `EvmCheckoutSettlement`, runs one indexer pass, and asserts ledger plus merchant balance truth.
- `seed-cardforge-local-project.js` logs in with the local dev signer, creates a fresh local-dev ZamaPay project secret and webhook endpoint, and writes only `ZAMAPAY_SECRET_KEY` into the ignored CardForge backend env.
- `sdk-local-smoke.mjs` verifies `@zamapay/server` against a running local API by bootstrapping the project secret, creating one ERC20 checkout, and retrieving it.
- `sync-cardforge-frontend-generated.js` copies root generated contract clients and runtime profiles into the standalone CardForge frontend package.
- `verify-runtime-profile.js` is the cheap preflight gate for local-dev, Sepolia local UI, and public preview config.
- `local-full-verify.js` is the final local acceptance gate; it first checks runtime profile config, then runs `just check`, live web e2e, production web build, and readiness proof with the inherited local API URL.
- `local-readiness.js` is dependency-light Node and verifies the profile-selected manifest, Rust API, Next pages, wallet login, and dev-signer boundary.
- `reset-local-dev.js` is the complete local-dev reset entry: it verifies the profile-selected Hardhat Local RPC is reachable, recreates the `zamapay` and `cardforge` databases, redeploys contracts, and refreshes standalone generated snapshots.
- The old merchant loop script was removed because it wrote payment projections directly; the accepted checkout path now proves payment through `PrivateCheckoutSettlement`.
- Public-testnet shell composition lives in `Justfile`; root scripts only validate profile contracts and local readiness.
- `postgres-init/` contains Docker-only database bootstrap SQL; it creates the independent CardForge database on fresh local volumes without mixing CardForge tables into the ZamaPay platform database.
