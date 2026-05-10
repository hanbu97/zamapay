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

## Secret Rule

Do not commit files ending in `.env`. Commit only `.env.example`.

Secret variables:

- `DATABASE_URL`
- `CARDFORGE_DATABASE_URL`
- `ZAMAPAY_API_KEY`
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
