# Indexer Architecture

## Scope

- `src/lib.rs` owns payment/finality/decrypt/fulfillment state transitions after an operator has already verified local private checkout evidence.
- This crate owns reorg handling, invoice expiry projection, finality transitions, and incident-state transitions.

## Boundary

- Input: canonical operator observations and confirmation counts.
- Output: `domain::SettlementSnapshot` plus operator-facing queue and exception states.
- This crate no longer decodes the removed transparent invoice log path; web/server code verifies `PrivatePaymentFinalized` before posting projection.
