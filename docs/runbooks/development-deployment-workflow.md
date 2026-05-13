# Development And Deployment Workflow

## Purpose

This is the workflow contract for ZamaPay and CardForge development. Use it before inventing shell commands, adding new env files, or changing deployment behavior.

The stable entrypoints are:

- `Justfile` for human and agent commands.
- `.mise.toml` for Node/npm and command-runner tooling.
- `env/runtime-profiles.json` for runtime shape.
- `env/*.env.example` for process env contracts.
- ignored same-name `env/*.env` files for local secrets.

Rust is not managed by mise in this repo. Keep using the workspace Rust toolchain.

## Bootstrap

Install the command runners once on macOS:

```bash
brew install mise just
```

Then initialize the workspace from the repo root:

```bash
mise trust
mise install
just doctor
just setup
```

`just setup` installs root Node dependencies, installs the standalone CardForge frontend dependencies, and syncs generated CardForge runtime snapshots.

## Rules

- Start with `just --list`.
- Prefer `just` recipes over raw `npm`, `cargo`, `docker`, Hardhat, or `set -a; . env/...` command sequences.
- Add a new `just` recipe when an operation becomes repeatable.
- Keep runtime defaults in `env/runtime-profiles.json`.
- Keep process-specific values in `env/*.env.example`.
- Never commit same-name `env/*.env` files.
- Run `just clean-local-dev` after branch churn, runtime-profile changes, env changes, or visual/CSS cache confusion.

## Local Development

Start local infrastructure:

```bash
just db-up
just contracts-node
```

In another terminal, reset chain-coupled local state:

```bash
just reset-local
```

`just reset-local` recreates both local databases, redeploys local contracts, refreshes generated clients, and clears local web caches. Run it after every Hardhat Local reset before starting API, web, or CardForge services.

Start ZamaPay:

```bash
just api-local
just web-local
```

Start CardForge:

```bash
just cardforge-api-local
just cardforge-web-local
```

Run the fast local gate after Hardhat, API, and web are running:

```bash
just verify-local
```

Run the heavier gate when preparing a handoff:

```bash
just verify-full
```

Run the full code-quality gate before broad commits or release branches:

```bash
just check
just build-web
```

## CardForge Project Binding

CardForge is a standalone merchant demo. It does not own ZamaPay merchant state. It needs a ZamaPay project id, API key, and webhook secret in `env/local-dev.cardforge-backend.env`.

Automated local seed path:

```bash
just seed-cardforge-local-project
```

This uses the local dev signer to create a ZamaPay project and update the ignored CardForge backend env file.

Manual browser path:

1. Open `http://127.0.0.1:3001/merchant`.
2. Sign in with the merchant wallet.
3. Create a payment project.
4. Copy the one-time CardForge backend exports.
5. Put those values into `env/local-dev.cardforge-backend.env`.
6. Restart `just cardforge-api-local`.

The manual path is the right proof when testing that the merchant wallet can later withdraw. The project owner must match the MetaMask account used on the merchant console.

## Browser Payment E2E

For local-dev browser testing:

1. MetaMask must be on Hardhat Local chain `31337`.
2. Buyer wallet must have local ETH for gas.
3. Buyer wallet must claim local mock cUSDT from CardForge.
4. CardForge creates a hosted checkout through its backend.
5. ZamaPay checkout asks the buyer wallet to submit encrypted payment.
6. ZamaPay finalizes the private payment and dispatches the signed webhook.
7. CardForge releases the card.
8. Merchant project overview shows paid gross, fee, and withdrawable balance.
9. Merchant wallet signs `PrivateWithdraw`.
10. Project balance falls to zero and a completed withdrawal appears in balance activity.

Use UI evidence plus backend evidence. At minimum, record the checkout id, chain invoice id, payment tx, webhook delivery status, withdrawal id, and withdrawal receipt.

## Supabase Local Run

Use Supabase for Postgres while keeping the local Hardhat chain:

```bash
just api-supabase-local
just cardforge-api-supabase-local
```

The later env file wins. The Supabase override should change only the database URL.

## Sepolia Local UI

Sepolia local-UI uses real Sepolia contracts and local API/web processes.

Prepare env files:

```bash
cp env/sepolia.contracts.env.example env/sepolia.contracts.env
cp env/supabase.zamapay-api.env.example env/supabase.zamapay-api.env
cp env/supabase.cardforge-backend.env.example env/supabase.cardforge-backend.env
cp env/sepolia.cardforge-backend.env.example env/sepolia.cardforge-backend.env
```

Validate and deploy:

```bash
just verify-runtime sepolia-local-ui
just deploy-sepolia-contracts
```

Start services:

```bash
just api-sepolia-local-ui
just web-sepolia-local-ui
just cardforge-api-sepolia-local-ui
just cardforge-web-sepolia-local-ui
```

Sepolia browser FHE operations use Zama's official test relayer through `@zama-fhe/relayer-sdk`. Do not replace that with a ZamaPay-owned relayer in this MVP.

## Public Preview

Before preview deployment:

```bash
just preview-check
just build-web
```

`preview-check` validates the public runtime profile shape. Public preview values must be explicit HTTPS/public RPC values, not localhost fallbacks.

## Recovery

Use these paths before debugging deeper:

| Symptom | First recovery |
| --- | --- |
| Browser UI looks stale after branch or env changes | `just clean-local-dev`, then restart the web recipe. |
| Chain addresses mismatch generated clients | Keep Hardhat running, then `just reset-local`. |
| CardForge points at an old project | Update ignored CardForge backend env, then restart `just cardforge-api-local`. |
| Sepolia/local-UI accidentally reads local-dev manifest | Check `NEXT_PUBLIC_RUNTIME_PROFILE`, then run `just verify-runtime sepolia-local-ui`. |
| Rust integration tests fail from missing database | `just db-up`, then rerun through `just check` or `just rust-test`. |

## Documentation Contract

When changing the workflow:

1. Update the relevant `just` recipe or env helper first.
2. Update `env/README.md` if env ownership changes.
3. Update this runbook if command order changes.
4. Update the root `README.md` only for the high-level path.
5. Update `docs/runbooks/ARCHITECTURE.md` when runbook structure changes.
