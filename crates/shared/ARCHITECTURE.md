# Shared Architecture

## Scope

- `src/lib.rs` contains transport DTOs shared between the Rust API and the Next.js client contract, including dashboard, invoice, and operator diagnostics payloads.
- `src/contracts.rs` parses repo-level generated contract manifests through the canonical contract environment map: dev/local aliases resolve to `local-dev`, test/testnet aliases resolve to `sepolia`.
- Billing DTOs define subscription status, billing cycle, private pass metadata, entitlement proof status, operator entitlement projection input, plan catalog entries, subscription payment records, checkout fee basis points, gross amount, platform fee, and merchant net snapshots; `contract_default` means Rust has no paid entitlement proof and must fall back to the free contract default.
- `contracts.rs` projects fee terms and subscription prices from generated contract manifests for catalog display and upgrade intent creation; the private subscription registry remains the only paid-tier authority.
- Checkout and invoice DTOs carry amount in minor units, optional chain invoice id, transaction hash, and finality depth because contract truth is created by the merchant wallet/backend bridge and projected into the Rust read model.
- Payment and subscription-entitlement projection DTOs are operator/indexer inputs only; they advance read-model payment truth or paid fee entitlement after chain evidence exists.
- Confirmation projection DTOs carry observed block depth, while indexer owns threshold decisions and persists the visible confirmations/threshold pair on the invoice DTO.
- Operator settlement event DTOs carry incident transitions, including invoice expiry, while indexer owns the resulting snapshot state.
- Webhook delivery DTOs carry operator delivery outcomes, signed dispatch envelopes, and retry/dead-letter snapshots on invoice records.
- Project withdrawal DTOs carry local payout records and summary counters so the browser can prove withdrawable balance changes after paid checkout sessions.
- Decrypt request and callback DTOs carry the merchant-visible Zama gateway lifecycle without exposing it as an operator-only incident.
- Operator diagnostics DTOs expose the indexer cursor and stalled flag alongside auth rejection counts, queue, finality, webhook, reorg, decrypt, and fulfillment incident counters.
- Fulfillment DTOs expose release decisions and audit metadata; merchant-template artifacts stay outside the platform API.

## Boundary

- `shared` carries HTTP payload shapes and typed session/invoice records.
- It must not become a second source of truth for chain ABI or raw event schema.
- It must not carry duplicated plan fee or subscription price constants; those values flow from deployed contract constants into the generated manifest, then into Rust/UI projections.
