# CardForge Backend Architecture

## Tree

```text
backend
|-- src/
|   `-- main.rs       # Axum API, Mermer Pay checkout proxy, webhook receiver
|-- Cargo.toml        # Rust package boundary
|-- Cargo.lock        # Backend dependency lockfile owned by the template
`-- .env.example      # Server-only Mermer Pay integration contract
```

## Decisions

- The backend is the only CardForge process that knows the Mermer Pay API URL, project id, project API key, webhook secret, and webhook endpoint.
- It is a standalone Rust package; it does not inherit root workspace versions or dependencies.
- `/api/orders/checkout` creates a Mermer Pay project checkout session with bearer API-key auth and never forwards buyer or merchant cookies.
- `/api/mermer-pay/webhook` verifies Mermer Pay signatures, then records callbacks in memory for the template demo boundary.
- Persistent fulfillment storage is intentionally absent here; this backend is a demo integration skeleton, not the production CardForge service.
