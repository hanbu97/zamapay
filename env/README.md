# Environment Files

These files make the runtime boundary explicit. Copy the example you need to the same name without `.example`, fill the secret values, then source it before starting that service.

```bash
cp env/local-dev.zamapay-api.env.example env/local-dev.zamapay-api.env
set -a
. env/local-dev.zamapay-api.env
set +a
cargo run -p api
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
- `NEXT_PUBLIC_CONTRACT_ENV`
- `NEXT_PUBLIC_CARDFORGE_DEMO_URL`
- `NEXT_PUBLIC_CARDFORGE_API_URL`
- `NEXT_PUBLIC_ZAMAPAY_CONSOLE_URL`
- `NEXT_PUBLIC_LOCAL_EXPLORER_URL`
- `NEXT_PUBLIC_SEPOLIA_RPC_URL`
- `NEXT_PUBLIC_SEPOLIA_EXPLORER_URL`

## Local Start

ZamaPay API:

```bash
set -a
. env/local-dev.zamapay-api.env
set +a
cargo run -p api
```

ZamaPay web:

```bash
set -a
. env/local-dev.zamapay-web.env
set +a
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

CardForge backend:

```bash
set -a
. env/local-dev.cardforge-backend.env
set +a
cargo run --manifest-path demo/cardforge/backend/Cargo.toml
```

CardForge frontend:

```bash
set -a
. env/local-dev.cardforge-frontend.env
set +a
npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002
```

## Supabase Local Run

Use Supabase as the Postgres host while keeping the local Hardhat chain:

```bash
set -a
. env/local-dev.zamapay-api.env
. env/supabase.zamapay-api.env
set +a
cargo run -p api
```

```bash
set -a
. env/local-dev.cardforge-backend.env
. env/supabase.cardforge-backend.env
set +a
cargo run --manifest-path demo/cardforge/backend/Cargo.toml
```

The later file wins, so Supabase overrides only the database URL.

## Sepolia Deploy And Local UI

Sepolia uses the real Zama FHEVM stack. Browser encrypted inputs and public decrypts use `@zama-fhe/relayer-sdk` `SepoliaConfig`, which points to Zama's official test relayer. Deploy contracts first:

```bash
cp env/sepolia.contracts.env.example env/sepolia.contracts.env
set -a
. env/sepolia.contracts.env
set +a
npm --workspace contracts run deploy:sepolia
```

Then start local ZamaPay against hosted Postgres and Sepolia contract manifests:

```bash
set -a
. env/local-dev.zamapay-api.env
. env/supabase.zamapay-api.env
. env/sepolia.zamapay-api.env
set +a
cargo run -p api
```

```bash
set -a
. env/sepolia.zamapay-web.env
set +a
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
```

For the local Sepolia demo, `ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY` must be the deployed
`PrivateCheckoutSettlement.checkoutCreator`; it creates the private checkout invoice
before CardForge opens hosted checkout. Buyer payment still happens from the browser
wallet on the checkout page.

Start CardForge against the Sepolia ZamaPay project and hosted Postgres:

```bash
set -a
. env/sepolia.cardforge-backend.env
. env/supabase.cardforge-backend.env
set +a
cargo run --manifest-path demo/cardforge/backend/Cargo.toml
```

```bash
set -a
. env/sepolia.cardforge-frontend.env
set +a
npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002
```

For production previews, use the workspace build script as-is. It runs `next build --webpack` because the current Zama browser SDK/WASM chunk can stall Next 16 Turbopack optimized builds.
