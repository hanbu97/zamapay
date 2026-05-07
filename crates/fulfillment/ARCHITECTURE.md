# Fulfillment Architecture

## Scope

- `src/lib.rs` decides when a settlement is eligible for exactly-once release.

## Boundary

- Input: projected settlement state from `domain`.
- Output: enqueue / freeze / no-op decisions for downstream release workers.
- This crate does not infer payment truth from chain data.
