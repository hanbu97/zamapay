# CardForge

Standalone merchant template for proving a ZamaPay integration without mounting merchant product code inside the payment platform.

## Run

Start ZamaPay API and web from the repository root first. In the ZamaPay console, create a project, create an API key, and add this webhook URL:

```text
http://127.0.0.1:8092/api/zamapay/webhook
```

After every Hardhat Local reset, run the root reset command before starting the platform and demo services:

```bash
npm run reset:local-dev
```

This recreates the separate `zamapay` and `cardforge` databases before redeploying local contracts.

Copy the shell exports shown by the ZamaPay project dialog into the CardForge backend terminal. The bundle includes `ZAMAPAY_CHAIN_INVOICE_API_URL=http://127.0.0.1:3001`, so CardForge creates a local-dev private settlement invoice before it opens hosted checkout. Then run the template from its own directories.

```bash
set -a
. env/local-dev.cardforge-backend.env
set +a
cargo run --manifest-path demo/cardforge/backend/Cargo.toml
```

```bash
set -a
. env/local-dev.cardforge-frontend.env
set +a
npm --prefix demo/cardforge/frontend install
npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002
```

Use Supabase for CardForge storage by sourcing the local file first and the Supabase override second:

```bash
set -a
. env/local-dev.cardforge-backend.env
. env/supabase.cardforge-backend.env
set +a
cargo run --manifest-path demo/cardforge/backend/Cargo.toml
```

Optional local explorer links can be enabled for the wallet activity panel:

```bash
NEXT_PUBLIC_LOCAL_EXPLORER_URL=http://127.0.0.1:4000 npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002
```

When no local explorer is running, CardForge still records and displays the confirmed transaction hash.

## Boundary

- `frontend/` owns catalog UI and buyer intent; Buy sends only the selected product id.
- `backend/` owns server-side product amounts, ZamaPay checkout creation, local-dev private invoice creation, webhook receipt, release policy, and CardForge-owned Postgres state.
- ZamaPay owns login, project configuration, hosted checkout, invoice truth, finality, and settlement.
- The root ZamaPay workspace does not start, build, lint, or import this template.
- CardForge uses `ZAMAPAY_PROJECT_ID` and `ZAMAPAY_API_KEY` only; it does not forward `zamapay_session` cookies to ZamaPay.
