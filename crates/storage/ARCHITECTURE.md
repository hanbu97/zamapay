# Storage Architecture

## Scope

- `src/lib.rs` owns auth/session stores, invoice read-model projections, operator/indexer projection methods, diagnostics counters, and persistence orchestration.
- `src/projects.rs` owns payment-project state transitions: project creation, project API keys, hosted checkout sessions, project-scoped invoice projection, webhook outbox records, delivery attempts, retries, and dashboard overview reads.
- `src/project_support.rs` owns project-only support types and pure helpers: stored API-key hash records, checkout-session errors, environment manifests, signer metadata, secret hashing, webhook secrets, and dashboard counters.
- `src/persistence.rs` owns the JSON file envelope used when `MERMER_PORTAL_STORE_PATH` is enabled.
- `src/invoice_seed.rs` owns deterministic local invoice construction shared by legacy invoices and project checkout projection.

## Structure

```text
src/
├── lib.rs              # public in-memory store surface and invoice projections
├── projects.rs         # payment-project/session/key/webhook state machine
├── project_support.rs  # project helper data and pure derivation functions
├── persistence.rs      # file-backed portal snapshot schema
└── invoice_seed.rs     # deterministic invoice record factory
```

## Decisions

- Payment truth changes enter storage through explicit projection methods rather than ad hoc mutation in HTTP handlers.
- Finality confirmation progress is stored beside the invoice snapshot, so checkout and ops pages read observed block depth from the same projection record that releases fulfillment.
- Webhook delivery changes enter through a single projection method, so retry, dead-letter, and recovery state share the domain state machine.
- Decrypt request changes enter through a single projection method; diagnostics count only requested or pending-result jobs as pending, while completed, failed, and idle states stay out of the queue count.
- Fulfillment release is idempotent: the first finality-safe release writes one job id and later reads reuse that audit instead of creating duplicate artifacts.
- Diagnostics are computed from invoice snapshots plus the API-owned operator auth rejection count; indexer cursor state is derived from projected chain invoice ids and payment tx hashes, so operator pages do not become a parallel incident database.
- Amount truth is stored with the invoice record; checkout and chain calls consume it instead of accepting buyer-supplied payment amounts.
- `MERMER_PORTAL_STORE_PATH` activates JSON persistence for portal invoices and projection state; unset keeps tests and local development purely in memory.
- File persistence is a local durability boundary, not the final production database abstraction.
- Project support helpers are outside `projects.rs` so the state machine stays readable and does not hide policy inside formatting or hashing code.
- The persistence envelope is outside `lib.rs`; serialization shape is a storage detail, not the public store contract.

## Boundary

- This crate owns local portal persistence only.
- It does not own HTTP contracts or business-state decisions.
