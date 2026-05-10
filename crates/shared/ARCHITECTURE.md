# Shared Architecture

## Scope

- `src/lib.rs` contains transport DTOs shared between the Rust API and the Next.js client contract, including dashboard, invoice, billing, project, withdraw, and operator diagnostics payloads.
- `src/contracts.rs` parses the generated local-dev contract manifest; dev/local aliases resolve to `local-dev`, and public-testnet aliases are intentionally unsupported.
- Billing DTOs define subscription status, billing cycle, private pass metadata, entitlement proof status, plan catalog entries, subscription payment records, checkout fee basis points, gross amount, platform fee, and merchant net snapshots.
- Checkout and invoice DTOs carry amount in minor units, immutable billing split, merchant owner wallet, optional chain invoice id, transaction hash, and finality depth because private checkout evidence is projected into the Rust read model.
- Project withdrawal DTOs require wallet-signed chain transaction evidence and carry local payout records plus summary counters so the browser can prove withdrawable balance changes after paid checkout sessions.

## Boundary

- `shared` carries HTTP payload shapes and typed session/invoice records.
- It must not become a second source of truth for chain ABI or raw event schema.
- It must not carry duplicated plan fee or subscription price constants; those values flow from deployed contract constants into the generated manifest, then into Rust/UI projections.
