# Rust Workspace Architecture

## Tree

```text
crates
|-- api/           # Axum entrypoint, cookies, CORS, session boundary
|-- domain/        # Pure auth rules plus payment/finality/decrypt/fulfillment state vocabulary
|-- storage/       # In-memory auth plus optional file-backed merchant portal read models
|-- indexer/       # Payment truth projection, finality transitions, and reorg exceptions
|-- fulfillment/   # Finality-gated exactly-once release decisions
`-- shared/        # Shared API DTOs, typed ids, and invoice/dashboard transport shapes
```

## Decisions

- `api` depends inward on `domain`, `storage`, `shared`, `indexer`, and `fulfillment`.
- `shared` carries transport shapes only; it must not become chain-schema duplication later.
- `indexer` and `fulfillment` exist now to avoid a second structural migration in Phase 2.
- operator diagnostics must stay on a separate auth boundary from merchant sessions.
- portal invoice persistence is file-backed for the hackathon demo when `MERMER_PORTAL_STORE_PATH` is set; production database work stays behind the storage crate boundary.
