# Shared Architecture

## Scope

- `src/lib.rs` contains transport DTOs shared between the Rust API and the Next.js client contract, including dashboard, invoice, billing, project payment rail settings, project-secret bootstrap, withdraw, and operator diagnostics payloads.
- `src/contracts.rs` parses generated contract manifests from explicit runtime profile or manifest keys; legacy dev/testnet aliases are intentionally unsupported.
- `src/merchant_contract.rs` defines the merchant API preview version header and typed SDK error envelope used by contract fixtures.
- `src/webhook.rs` owns webhook transport DTOs plus `chrono`-based compatibility wrappers; protocol signing, verification, secret preview, payload hash, and `svix-*` constants come from `webhook-verifier`.
- `tests/merchant_api_contract.rs` proves the shared merchant fixture still deserializes into current DTOs and still verifies against the Rust webhook protocol.
- Billing DTOs define subscription status, billing cycle, private pass metadata, entitlement proof status, plan catalog entries, subscription payment records, checkout fee basis points, gross amount, platform fee, and merchant net snapshots.
- Checkout and invoice DTOs carry amount in minor units, immutable billing split, merchant owner wallet, optional chain invoice id, transaction hash, and finality depth because private checkout evidence is projected into the Rust read model.
- Project withdrawal DTOs require wallet-signed chain transaction evidence and carry local payout records plus summary counters so the browser can prove withdrawable balance changes after paid checkout sessions.
- Project payment rail DTOs expose merchant-managed `zama_private` and `evm_erc20` enablement; they describe project policy, not chain payment truth.
- Ordinary EVM DTOs carry settlement intent id, settlement project id, settlement contract, gross amount, merchant net, and platform fee so HTTP callers cannot collapse settlement events back into bare ERC20 transfers.
- Merchant SDK fixtures define preview examples and normalized error envelopes; the live API remains the runtime truth.

## Boundary

- `shared` carries HTTP payload shapes and typed session/invoice records.
- It must not become a second source of truth for chain ABI or raw event schema.
- It must not carry duplicated plan fee or subscription price constants; those values flow from deployed contract constants into the generated manifest, then into Rust/UI projections.
- Webhook helpers may expose parsed payload DTOs, hashes, previews, and verifier functions; they must not serialize raw payload bytes, encrypted secret ciphertext, or replayable signature headers to browser-facing responses.
