# CardForge Backend Architecture

## Tree

```text
backend
|-- src/
|   |-- catalog.rs    # Server-owned card catalog, checkout payload, and released-code derivation
|   |-- config.rs     # Environment contract, Railway bind fallback, CORS origins, and local-dev defaults
|   |-- error.rs      # API error envelope and Axum response mapping
|   |-- main.rs       # Axum routes, ZamaPay bridge, webhook verification, and orchestration
|   |-- process.rs    # Demo restart guard for replacing only old cardforge-backend listeners
|   |-- store.rs      # CardForge-owned Postgres schema and read/write model
|   |-- tests.rs      # Backend route, webhook, catalog, and wallet activity regression tests
|   `-- types.rs      # DTOs shared by routes, catalog, and storage
|-- Cargo.toml        # Rust package boundary
|-- Cargo.lock        # Backend dependency lockfile owned by the template
|-- railway.toml      # Railway build/start contract for the standalone backend service
|-- rust-toolchain.toml # Builder compiler pin for Railway and local deploy parity
`-- .env.example      # Server-only ZamaPay integration contract
```

## Decisions

- The backend is the only CardForge process that knows the ZamaPay API URL, project id, project API key, webhook secret, webhook endpoint, and allowed browser origins.
- It is a standalone Rust package; it does not inherit root workspace versions or dependencies.
- The Rust toolchain is pinned at the backend root so Railway does not fall back to an older compiler than the locked dependency graph supports.
- `railway.toml` copies the release binary to a stable runtime path so Railpack start commands do not depend on Cargo target-directory layout.
- `main.rs` is only the API composition layer; catalog data, process replacement, config parsing, storage, errors, and DTOs live in single-purpose modules.
- Startup replaces only an older `cardforge-backend` process listening on the same bind port; unrelated listeners are reported and left untouched.
- `/api/orders/prepare-checkout` pre-creates a short queue of product-scoped private settlement invoices so the storefront can warm Sepolia before the buyer clicks Buy.
- `/api/orders/checkout` accepts a product id plus optional buyer wallet for the merchant-owned local read model, derives amount and card release data from the server catalog, consumes a prepared private settlement invoice when one is available, then creates a project checkout session with bearer API-key auth and never forwards buyer or merchant cookies.
- Private settlement is mandatory for buy flow demos; checkout creation falls back to synchronous invoice creation when no warmed invoice is available and fails if the encrypted chain invoice bridge is unavailable.
- `CARDFORGE_DATABASE_URL` is required and points at a CardForge-owned Postgres database, separate from the ZamaPay platform database; startup uses bounded Postgres connect, acquire, and statement timeouts so a slow Supabase endpoint fails clearly instead of half-starting the demo.
- `CARDFORGE_STORE_KEY` namespaces local runs inside that database without becoming a second storage backend.
- `/api/zamapay/webhook` verifies ZamaPay signatures, records callbacks, releases demo cards only for `invoice.fulfillment_ready` payloads that are `paid` and `finality_safe`, then persists the fulfilled card under the buyer wallet captured at checkout creation.
- `/api/wallets/{wallet}/activity` exposes only that wallet's owned-card read model and confirmed checkout payment hashes for the storefront sidebar.
- `/api/fulfillment` reads the latest release from CardForge Postgres so browser QA can prove the merchant app received the signed callback and unlocked cards after backend restart.
- Pending orders, owned cards, webhook receipts, and latest fulfillment are normalized Postgres tables; the old JSON file and in-memory read models are not runtime truth.
