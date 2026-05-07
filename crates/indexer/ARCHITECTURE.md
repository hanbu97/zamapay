# Indexer Architecture

## Scope

- `src/lib.rs` decodes `InvoicePaid` logs into operator projection requests, applies confirmation counts, and projects operator incident events into payment/finality/decrypt/fulfillment state.
- This crate owns reorg handling, invoice expiry projection, finality transitions, and incident-state transitions.

## Boundary

- Input: canonical chain observations.
- Output: `domain::SettlementSnapshot` plus operator-facing queue and exception states.
- This crate does not own webhook delivery, decrypt execution, or artifact release.
