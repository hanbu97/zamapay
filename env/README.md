# Environment Files

These files make the runtime boundary explicit. Copy the example you need to the same name without `.example`, fill the secret values, then run the matching `just` recipe from the repo root. The `Justfile` is the workflow entrypoint; manual `set -a; . env/...` sourcing is for debugging only.

The command order and deployment lanes are documented in [`docs/runbooks/development-deployment-workflow.md`](../docs/runbooks/development-deployment-workflow.md). This file owns env-file contracts only.

```bash
cp env/local-dev.zamapay-api.env.example env/local-dev.zamapay-api.env
just api-local
```

## Files

| File | Process | Contains secrets | Purpose |
| --- | --- | --- | --- |
| `local-dev.zamapay-api.env` | ZamaPay Rust API | yes | API bind, platform database, operator/gateway/webhook keys. |
| `local-dev.zamapay-web.env` | ZamaPay Next.js web | no for browser values, yes for server-only bridge keys | Dashboard, checkout, local-dev chain bridge, and dev signer gate. |
| `local-dev.cardforge-backend.env` | CardForge Rust backend | yes | Merchant project API key, webhook secret, and CardForge database. |
| `local-dev.cardforge-frontend.env` | CardForge Next.js storefront | no | Browser-safe CardForge API and ZamaPay console URLs. |
| `supabase.zamapay-api.env` | ZamaPay Rust API | yes | Replaces local Docker `DATABASE_URL` with Supabase Postgres. |
| `supabase.cardforge-backend.env` | CardForge Rust backend | yes | Replaces local Docker `CARDFORGE_DATABASE_URL` with CardForge Supabase Postgres. |
| `sepolia.contracts.env` | Hardhat deployer | yes | Sepolia RPC, deployer key, and optional platform fee wallet. |
| `sepolia.zamapay-api.env` | ZamaPay Rust API | no | Selects the Sepolia contract manifest. |
| `sepolia.zamapay-web.env` | ZamaPay Next.js web | yes for chain invoice signer | Selects Sepolia wallet/manifest config and lets the local demo server create private checkout invoices. |
| `sepolia.cardforge-backend.env` | CardForge Rust backend | yes | Merchant project credentials for a Sepolia ZamaPay project. |
| `sepolia.cardforge-frontend.env` | CardForge Next.js storefront | no | Browser-safe Sepolia demo links. |

## Runtime Profiles

`runtime-profiles.json` is the shared contract for local and public-testnet runtime shape. Code should read chain id, RPC env names, API/web defaults, checkout base URLs, and finality defaults from this file instead of inventing local fallbacks.

| Profile | Contract env | Purpose |
| --- | --- | --- |
| `local-dev` | `local-dev` | Hardhat Local, local Rust API, local Next.js checkout. |
| `sepolia-local-ui` | `sepolia` | Sepolia contracts with local API/web processes for testnet QA. |
| `sepolia-preview` | `sepolia` | Public preview shape; RPC and public URLs must be explicit HTTPS values. |

Use these gates before switching environments:

```bash
just verify-runtime local-dev
just verify-runtime sepolia-local-ui
just preview-check
```

When a profile changes, update `env/runtime-profiles.json`, run `just verify-runtime <profile>`, regenerate CardForge snapshots with `just sync-cardforge-generated`, and restart the affected web process through its `just *web*` recipe so stale `.next` state cannot hide the change.

## Secret Rule

Do not commit files ending in `.env`. Commit only `.env.example`.

Secret variables:

- `DATABASE_URL`
- `CARDFORGE_DATABASE_URL`
- `DEPLOYER_PRIVATE_KEY`
- `PRIVATE_KEY`
- `SEPOLIA_RPC_URL`
- `ZAMAPAY_API_KEY`
- `ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY`
- `ZAMAPAY_WEBHOOK_SECRET`
- `ZAMAPAY_OPERATOR_KEY`
- `ZAMAPAY_GATEWAY_CALLBACK_KEY`
- `ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY`

Public browser variables:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_RUNTIME_PROFILE`
- `NEXT_PUBLIC_CARDFORGE_DEMO_URL`
- `NEXT_PUBLIC_CARDFORGE_API_URL`
- `NEXT_PUBLIC_ZAMAPAY_CONSOLE_URL`
- `NEXT_PUBLIC_LOCAL_EXPLORER_URL`
- `NEXT_PUBLIC_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_SEPOLIA_EXPLORER_URL`

## Local Start

ZamaPay API:

```bash
just api-local
```

ZamaPay web:

```bash
just web-local
```

CardForge backend:

```bash
just cardforge-api-local
```

CardForge frontend:

```bash
just cardforge-web-local
```

CardForge project credentials are not copied from examples. Create them with either `just seed-cardforge-local-project` or the merchant-console one-time export flow described in the workflow runbook, then restart `just cardforge-api-local`.

## Supabase Local Run

Use Supabase as the Postgres host while keeping the local Hardhat chain:

```bash
just api-supabase-local
```

```bash
just cardforge-api-supabase-local
```

The later file wins, so Supabase overrides only the database URL.

## Sepolia Deploy And Local UI

Sepolia uses the real Zama FHEVM stack. Browser encrypted inputs and public decrypts use `@zama-fhe/relayer-sdk` `SepoliaConfig`, which points to Zama's official test relayer. Deploy contracts first:

```bash
cp env/sepolia.contracts.env.example env/sepolia.contracts.env
just deploy-sepolia-contracts
```

Then start local ZamaPay against hosted Postgres and Sepolia contract manifests:

```bash
just api-sepolia-local-ui
```

```bash
just web-sepolia-local-ui
```

For the local Sepolia demo, `ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY` must be the deployed
`PrivateCheckoutSettlement.checkoutCreator`; it creates the private checkout invoice
before CardForge opens hosted checkout. Buyer payment still happens from the browser
wallet on the checkout page. When CardForge calls the bridge through a non-local
production URL, it reuses the existing project API key and the web app validates the
requested billing split against the Rust API before signing a chain invoice.

Start CardForge against the Sepolia ZamaPay project and hosted Postgres:

```bash
just cardforge-api-sepolia-local-ui
```

```bash
just cardforge-web-sepolia-local-ui
```

Before a public preview deploy, run:

```bash
just preview-check
```

For production previews, use `just build-web`. It runs `next build --webpack` because the current Zama browser SDK/WASM chunk can stall Next 16 Turbopack optimized builds.
