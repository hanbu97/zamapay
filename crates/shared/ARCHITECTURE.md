# Shared Architecture

## Scope

- `src/lib.rs` contains transport DTOs shared between the Rust API and the Next.js client contract, including dashboard, invoice, and operator diagnostics payloads.
- `src/contracts.rs` parses repo-level generated contract manifests by environment so Rust can consume local and Sepolia deployment truth without reaching into Hardhat artifact directories.
- Invoice DTOs carry amount in minor units, optional chain invoice id, transaction hash, and finality depth because contract truth is created by the merchant wallet and projected into the Rust read model.
- Payment projection DTOs are operator/indexer inputs only; they advance read-model payment truth after a chain payment exists.
- Confirmation projection DTOs carry observed block depth, while indexer owns threshold decisions and persists the visible confirmations/threshold pair on the invoice DTO.
- Operator settlement event DTOs carry incident transitions, including invoice expiry, while indexer owns the resulting snapshot state.
- Webhook delivery DTOs carry operator delivery outcomes, signed dispatch envelopes, and retry/dead-letter snapshots on invoice records.
- Decrypt request and callback DTOs carry the merchant-visible Zama gateway lifecycle without exposing it as an operator-only incident.
- Operator diagnostics DTOs expose the indexer cursor and stalled flag alongside auth rejection counts, queue, finality, webhook, reorg, decrypt, and fulfillment incident counters.
- Fulfillment DTOs expose release decisions and audit metadata; merchant-template artifacts stay outside the platform API.

## Boundary

- `shared` carries HTTP payload shapes and typed session/invoice records.
- It must not become a second source of truth for chain ABI or raw event schema.
