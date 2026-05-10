# Storage Architecture

## Scope

- `src/lib.rs` owns async process-local auth/session stores, session deletion, portal read-model projections, operator/indexer projection methods, diagnostics counters, and the `PortalStore` cache surface.
- `src/billing.rs` owns the merchant billing read model, subscription payment history, self-serve upgrade intent projection, operator-projected chain entitlement, and contract-manifest fee-term lookup; dashboard/API-key callers still cannot write paid entitlement.
- `src/projects.rs` owns payment-project state transitions: project creation, project API keys, hosted checkout quote snapshots, hosted checkout sessions, project-scoped invoice projection, webhook outbox records, delivery attempts, retries, local withdraw records, and dashboard overview reads.
- `src/projections.rs` owns pure invoice projection and diagnostics helpers shared by the store surface.
- `src/project_support.rs` owns project-only support types and pure helpers: stored API-key hash records, checkout-session errors, environment manifests, signer metadata, secret hashing, webhook secrets, billing/withdraw totals, and dashboard counters.
- `src/pg_store/` owns async SeaORM-backed normalized tables, DTO row mapping, schema creation, and full-record replacement transactions.
- `src/invoice_seed.rs` owns deterministic local invoice construction shared by legacy invoices and project checkout projection.

## Structure

```text
src/
├── lib.rs              # async Postgres-backed portal store surface and projections
├── billing.rs          # subscription state and contract fee-term projection
├── projects.rs         # payment-project/session/key/webhook state machine
├── projections.rs      # pure invoice projection and diagnostics helpers
├── project_support.rs  # project helper data and pure derivation functions
├── pg_store/           # async SeaORM schema, DTOs, and normalized table repository
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
- Project checkout quotes expose the active fee split and merchant owner wallet before local chain invoice creation, so merchant backends cannot invent net/fee math.
- Project checkout sessions require caller-supplied chain invoice id/hash from an already-created private checkout; missing chain evidence is an invalid request.
- The contract manifest is the catalog source; storage applies the free `contract_default` plan until an operator-projected anchored entitlement supplies non-empty pass, tx, handle, and version evidence.
- Subscription payments are stored as an owner-scoped ledger for historical read-model display and are appended idempotently from operator entitlement projection.
- Project withdrawals are read-model records for contract-proven payouts; storage can project them, but API/UI code must not create them without a wallet-signed settlement transaction.
- Upgrade intents read charge amount and term length from the generated contract manifest; local-dev projects Growth by executing the private subscription registry proof before the operator projection writes the read model.
- Private entitlement metadata is accepted only from the operator projection boundary after chain verification; the chain registry remains the authority for encrypted fee terms.
- `DATABASE_URL` is required for portal invoices, projects, checkout sessions, webhook state, subscriptions, and withdrawal read models; this is the shared local Docker and hosted Postgres/Supabase contract.
- `MERMER_PORTAL_STATE_KEY` may namespace isolated local verification rows, but it stays inside the same normalized Postgres schema and does not introduce a second storage backend.
- Portal durability is normalized into purpose-named tables: projects, environments, invoice authorities, API keys, subscriptions, billing payments, invoices, checkout sessions, metadata, idempotency keys, webhook events, webhook deliveries, withdrawals, and counters.
- Runtime truth must live in normalized Postgres tables; there is no JSONB snapshot backend or memory-store fallback for portal data.
- Project support helpers are outside `projects.rs` so the state machine stays readable and does not hide policy inside formatting or hashing code.
- SeaORM DTOs are outside `lib.rs`; row shape is a storage detail, not the public store contract.
- Store APIs are async end-to-end: Tokio `RwLock` protects in-process maps, and SeaORM load/save awaits directly on the API runtime rather than spawning a blocking runtime bridge.

## Boundary

- This crate owns local portal persistence only.
- It does not own HTTP contracts or business-state decisions.
