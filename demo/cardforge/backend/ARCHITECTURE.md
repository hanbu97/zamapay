# CardForge Backend Architecture

## Tree

```text
backend
|-- src/
|   |-- catalog.rs    # Server-owned card catalog, rail-aware checkout payload, and released-code derivation
|   |-- config.rs     # Environment contract, rail selection, Railway bind fallback, CORS origins, and local-dev defaults
|   |-- error.rs      # API error envelope and Axum response mapping
|   |-- main.rs       # Axum routes, ZamaPay bridge, verifier-crate webhook checks, and orchestration
|   |-- process.rs    # Demo restart guard for replacing only old cardforge-backend listeners
|   |-- store.rs      # CardForge-owned Postgres schema and read/write model
|   |-- tests.rs      # Backend route, webhook, catalog, and wallet activity regression tests
|   `-- types.rs      # Rail, DTOs, and wallet activity records shared by routes, catalog, and storage
|-- Cargo.toml        # Rust package boundary
|-- Cargo.lock        # Backend dependency lockfile owned by the template
|-- railway.toml      # Railway build/start contract for the standalone backend service
|-- rust-toolchain.toml # Builder compiler pin for Railway and local deploy parity
`-- .env.example      # Server-only ZamaPay integration contract
```

## Decisions

- The backend is the only CardForge process that knows the ZamaPay API URL, `ZAMAPAY_SECRET_KEY`, webhook endpoint, and allowed browser origins.
- It is a standalone Rust package; it does not inherit root workspace versions or dependencies.
- It depends on the root `crates/webhook-verifier` package for Svix-style raw-body HMAC verification; merchant demos must not copy local HMAC helpers.
- The Rust toolchain is pinned at the backend root so Railway does not fall back to an older compiler than the locked dependency graph supports.
- `railway.toml` copies the release binary to a stable runtime path so Railpack start commands do not depend on Cargo target-directory layout.
- `main.rs` is only the API composition layer; catalog data, process replacement, config parsing, storage, errors, and DTOs live in single-purpose modules.
- Startup replaces only an older `cardforge-backend` process listening on the same bind port; unrelated listeners are reported and left untouched.
- `CARDFORGE_PAYMENT_RAIL` is the single switch for the merchant demo checkout path: `zama_private` warms and consumes local private-chain invoices; `evm_erc20` skips private invoice creation and asks ZamaPay for an ordinary ERC20 payment intent with `CARDFORGE_EVM_CHAIN_ID` and `CARDFORGE_EVM_TOKEN_SYMBOL`.
- `/api/orders/prepare-checkout` pre-creates a short queue of product-scoped private settlement invoices only for the private rail; the EVM rail is already prepared once ZamaPay can issue a settlement-contract payment intent.
- `/api/orders/checkout` accepts a product id plus optional buyer wallet for the merchant-owned local read model, derives amount and card release data from the server catalog, creates the configured project checkout session with bearer API-key auth, and never forwards buyer or merchant cookies.
- Private settlement remains available for Zama demos; ordinary EVM demos keep `chainInvoiceId` null and use the settlement ledger plus webhook outbox as payment truth.
- `CARDFORGE_DATABASE_URL` is required and points at a CardForge-owned Postgres database, separate from the ZamaPay platform database; startup uses bounded Postgres connect, acquire, and statement timeouts so a slow Supabase endpoint fails clearly instead of half-starting the demo.
- `CARDFORGE_STORE_KEY` namespaces local runs inside that database without becoming a second storage backend.
- Startup exchanges `ZAMAPAY_SECRET_KEY` with ZamaPay `/api/project-secret/bootstrap`, then keeps the returned project id and current `whsec_` verifier secret inside the backend process.
- `/api/zamapay/webhook` reads raw request bytes, delegates Svix-style `svix-*` HMAC verification to `webhook-verifier`, parses JSON only after verification, records callbacks, releases demo cards only for `invoice.fulfillment_ready` payloads that are `paid` and `finality_safe`, then persists the fulfilled card under the buyer wallet captured at checkout creation.
- `/api/wallets/{wallet}/activity` exposes only that wallet's owned-card read model and confirmed checkout payment hashes for the storefront sidebar.
- `/api/fulfillment` reads the latest release from CardForge Postgres so browser QA can prove the merchant app received the signed callback and unlocked cards after backend restart.
- Pending orders, owned cards, webhook receipts, and latest fulfillment are normalized Postgres tables; the old JSON file and in-memory read models are not runtime truth.
