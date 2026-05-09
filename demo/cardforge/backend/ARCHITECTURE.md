# CardForge Backend Architecture

## Tree

```text
backend
|-- src/
|   `-- main.rs       # Axum API, demo restart guard, server catalog, private invoice bridge, local owned-card state
|-- Cargo.toml        # Rust package boundary
|-- Cargo.lock        # Backend dependency lockfile owned by the template
`-- .env.example      # Server-only Mermer Pay integration contract
```

## Decisions

- The backend is the only CardForge process that knows the Mermer Pay API URL, project id, project API key, webhook secret, and webhook endpoint.
- It is a standalone Rust package; it does not inherit root workspace versions or dependencies.
- Startup replaces only an older `cardforge-backend` process listening on the same bind port; unrelated listeners are reported and left untouched.
- `/api/orders/checkout` accepts a product id plus optional buyer wallet for the merchant-owned local read model, derives amount and card release data from the server catalog, creates a local-dev private settlement invoice, then creates a project checkout session with bearer API-key auth and never forwards buyer or merchant cookies.
- Local-dev private settlement is mandatory for buy flow demos; falling back to read-model-only checkout would bypass the encrypted cUSDT payment path.
- `CARDFORGE_DATA_PATH` points to the local JSON source for pending checkouts and wallet-owned fulfilled cards. The default is `.cardforge-data.json` beside the launched backend process.
- `/api/mermer-pay/webhook` verifies Mermer Pay signatures, records callbacks, releases demo cards only for `invoice.fulfillment_ready` payloads that are `paid` and `finality_safe`, then persists the fulfilled card under the buyer wallet captured at checkout creation.
- `/api/wallets/{wallet}/activity` exposes only that wallet's owned-card read model and confirmed checkout payment hashes for the storefront sidebar.
- `/api/fulfillment` exposes the in-memory release read model so browser QA can prove the merchant app received the signed callback and unlocked cards.
- Webhook diagnostics and latest fulfillment are still in-memory; wallet-owned purchased cards are durable because the demo needs visible buyer inventory after checkout.
