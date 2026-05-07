# Domain Architecture

## Scope

- `src/lib.rs` holds auth-domain rules that are already live in Phase 1.
- `src/payment.rs` defines the canonical payment, expiry, finality, decrypt, webhook delivery, fulfillment, and operator incident state axes used by Phase 2 services.

## Boundary

- `domain` owns business vocabulary and pure decisions.
- Webhook retry/dead-letter behavior lives here as a pure state machine; storage and HTTP only project outcomes into it.
- `domain` does not own HTTP, storage drivers, chain ABI schemas, or relayer transport details.
