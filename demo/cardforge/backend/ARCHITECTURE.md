# CardForge Backend Architecture

## Tree

```text
backend
|-- src/
|   `-- main.rs       # Axum API, Mermer Pay checkout, chain-invoice/wallet proxies, webhook receiver
|-- Cargo.toml        # Rust package boundary
|-- Cargo.lock        # Backend dependency lockfile owned by the template
`-- .env.example      # Server-only Mermer Pay integration contract
```

## Decisions

- The backend is the only CardForge process that knows the Mermer Pay API URL, project id, project API key, webhook secret, and webhook endpoint.
- It is a standalone Rust package; it does not inherit root workspace versions or dependencies.
- `/api/orders/checkout` optionally asks Mermer Pay's local chain-invoice bridge to create the real settlement invoice, then creates a project checkout session with bearer API-key auth and never forwards buyer or merchant cookies.
- `/api/confidential-wallet/{address}` proxies the Mermer Pay local-dev confidential wallet projection so the storefront can show cUSDT inside CardForge without importing platform secrets or public ERC20 state.
- `/api/mermer-pay/webhook` verifies Mermer Pay signatures, records callbacks, and releases demo cards only for `invoice.fulfillment_ready` payloads that are `paid` and `finality_safe`.
- `/api/fulfillment` exposes the in-memory release read model so browser QA can prove the merchant app received the signed callback and unlocked cards.
- Persistent fulfillment storage is intentionally absent here; this backend is a demo integration skeleton, not the production CardForge service.
