# CardForge

Standalone merchant template for proving a ZamaPay integration without mounting merchant product code inside the payment platform.

## Run

Start ZamaPay API and web from the repository root first. In the ZamaPay console, create a project, create a project secret key, and add this webhook URL:

```text
http://127.0.0.1:8092/api/zamapay/webhook
```

After every Hardhat Local reset, run the root reset command before starting the platform and demo services:

```bash
npm run reset:local-dev
```

This recreates the separate `zamapay` and `cardforge` databases before redeploying local contracts.

Copy the `ZAMAPAY_SECRET_KEY` shell export shown by the ZamaPay project dialog into the CardForge backend terminal. Shared deployment endpoints such as `ZAMAPAY_CHAIN_INVOICE_API_URL=http://127.0.0.1:3001` stay in the env template, so CardForge can bootstrap project/webhook context. Keep `CARDFORGE_PAYMENT_RAIL=zama_private` for the private cUSDT path, or set `CARDFORGE_PAYMENT_RAIL=evm_erc20` with `CARDFORGE_EVM_CHAIN_ID=31337` and `CARDFORGE_EVM_TOKEN_SYMBOL=USDT` for ordinary ERC20 checkout testing. Then run the template from its own directories.

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
- `backend/` owns server-side product amounts, configured ZamaPay checkout rail creation, local-dev private invoice creation when the private rail is selected, webhook receipt, release policy, and CardForge-owned Postgres state.
- ZamaPay owns login, project configuration, hosted checkout, invoice truth, finality, and settlement.
- The root ZamaPay workspace does not start, build, lint, or import this template.
- CardForge uses the server-side `ZAMAPAY_SECRET_KEY` only; it does not forward `zamapay_session` cookies to ZamaPay.
