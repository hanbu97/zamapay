# Scripts Architecture

## Tree

```text
scripts
|-- postgres-init/
|   `-- 01-cardforge.sql
|-- local-full-verify.js
|-- local-readiness.js
|-- reset-local-dev.js
|-- run-rust-tests.sh
|-- run-with-env.sh
|-- runtime-profile.js
|-- seed-cardforge-local-project.js
|-- sync-cardforge-frontend-generated.js
`-- verify-runtime-profile.js
```

## Decisions

- Root scripts implement cross-package local-dev readiness; `Justfile` is the supported human-facing and agent-facing workflow entrypoint.
- Agents should call `just` recipes for repeatable setup, reset, service startup, deployment, and verification. Call scripts directly only while debugging script internals or wiring a new recipe.
- Package-local contract tasks stay in `contracts/scripts`.
- `run-rust-tests.sh` runs Rust workspace tests with a clean test env, the database URL from local-dev env, and serial test threads by default so Postgres-backed tests do not deadlock.
- `run-with-env.sh` is the tiny process launcher used by `Justfile`; it sources one or more service env files, exports them, then `exec`s the target command.
- `runtime-profile.js` is the Node reader for `env/runtime-profiles.json`; scripts must use it instead of repeating URL, RPC, chain id, or finality defaults.
- `seed-cardforge-local-project.js` logs in with the local dev signer, creates a fresh local-dev ZamaPay project/API key, and writes the ignored CardForge backend env.
- `sync-cardforge-frontend-generated.js` copies root generated contract clients and runtime profiles into the standalone CardForge frontend package.
- `verify-runtime-profile.js` is the cheap preflight gate for local-dev, Sepolia local UI, and public preview config.
- `local-full-verify.js` is the final local acceptance gate; it first checks runtime profile config, then stops at the first failed unit test, live web e2e test, build, contract check, Rust check, or readiness proof.
- `local-readiness.js` is dependency-light Node and verifies the profile-selected manifest, Rust API, Next pages, wallet login, and dev-signer boundary.
- `reset-local-dev.js` is the complete local-dev reset entry: it verifies the profile-selected Hardhat Local RPC is reachable, recreates the `zamapay` and `cardforge` databases, redeploys contracts, and refreshes standalone generated snapshots.
- The old merchant loop script was removed because it wrote payment projections directly; the accepted checkout path now proves payment through `PrivateCheckoutSettlement`.
- Public-testnet shell composition lives in `Justfile`; root scripts only validate profile contracts and local readiness.
- `postgres-init/` contains Docker-only database bootstrap SQL; it creates the independent CardForge database on fresh local volumes without mixing CardForge tables into the ZamaPay platform database.
