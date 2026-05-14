# Rust Workspace Architecture

## Tree

```text
crates
|-- api/           # Axum entrypoint, cookies, CORS, session boundary
|-- domain/        # Pure auth rules plus payment/finality/decrypt/fulfillment state vocabulary
|-- storage/       # Async process-local auth plus Postgres-backed merchant portal read models
|-- indexer/       # Payment truth projection, finality transitions, and reorg exceptions
|-- fulfillment/   # Finality-gated exactly-once release decisions
|-- shared/        # Shared API DTOs, typed ids, and invoice/dashboard transport shapes
`-- webhook-verifier/ # Small Svix-style HMAC verifier shared by platform and merchant demos
```

## Decisions

- `api` depends inward on `domain`, `storage`, `shared`, `indexer`, and `fulfillment`.
- `shared` carries transport shapes only; it must not become chain-schema duplication later.
- `webhook-verifier` owns the raw-body webhook protocol so every merchant demo verifies the same signed bytes without copying HMAC code.
- `indexer` and `fulfillment` exist now to avoid a second structural migration in Phase 2.
- operator diagnostics must stay on a separate auth boundary from merchant sessions.
- portal state is backed by normalized Postgres tables through `DATABASE_URL`; local Docker Postgres and hosted Postgres/Supabase use the same storage boundary.
- storage and API boundaries are async end-to-end; SeaORM is awaited directly and no synchronous runtime bridge owns database work.
