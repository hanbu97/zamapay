# PG Store Architecture

## Structure

```text
pg_store/
├── mod.rs         # module boundary and public storage adapter exports
├── schema.rs      # normalized Postgres DDL
├── dto.rs         # SeaORM query DTOs and domain-row conversion helpers
└── repository.rs  # connection setup plus load/save transactions over the normalized schema
```

## Decisions

- `schema.rs` creates lowercase snake_case tables with composite state-scoped primary keys and query indexes; schema creation runs inside one transaction with a transaction-scoped Postgres advisory lock, so remote pooled Postgres never keeps a session lock alive after startup failure.
- `dto.rs` is the only place that translates between database scalar rows and shared/domain structs.
- `repository.rs` exposes async connection, load, and save functions over normalized record sets and runs SeaORM directly on the caller's Tokio runtime; no blocking bridge, private runtime, or request-time pool rebuild exists here.
- Webhook event payloads keep parsed JSON text plus frozen raw JSON text and SHA-256 because dispatch signs the exact emitted bytes, not a later serialization.
- Webhook endpoint secrets are normalized into ciphertext/preview rows, while delivery attempts are append-only evidence rows; delivery state remains in the delivery aggregate table.
- Ordinary EVM tables persist settlement intent ids and settlement-contract cursors; receiver rows are catalog entries only and do not carry lease state.

## Boundary

- This module owns persistence mechanics only.
- It does not own billing policy, checkout state transitions, webhook retry rules, or HTTP DTOs.
