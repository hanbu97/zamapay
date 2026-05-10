# Web Library Architecture

## Tree

```text
apps/web/lib
|-- api.ts                  # Rust API fetch helpers and local-dev DTOs
|-- contract-environment.ts # Local-dev manifest, chain, and wallet environment map
|-- contracts.ts            # Generated ABI/address bridge and local chain definition
|-- dev-signer-gate.ts      # Pure environment gates for local browser signer and local server bridge
|-- local-fhevm-browser.ts  # Browser Hardhat/FHEVM mock RPC bridge for encrypted checkout and subscription inputs
|-- local-fhevm-dev.ts      # Server-only Hardhat FHEVM mock bridge for checkout, withdraw submission, and subscription finalization
|-- merchant-portal.ts      # Protected billing/project loader and failure mapping
|-- settlement-bucket.ts    # Deterministic settlement bucket commitment helper shared by invoice and withdraw flows
|-- time-format.ts          # Merchant-facing timestamp formatting with unambiguous midnight display
|-- utils.ts                # shadcn className merge helper
`-- wallet.ts               # Browser wallet account/session helpers and local chain switch/add helper
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, project authority, delivery state, fulfillment release truth, subscription entitlement, or billing math.
- Contract ABIs and billing/address manifests flow from `generated/clients/ts` so UI writes and public pricing follow compiled Solidity/deploy output.
- `contract-environment.ts` intentionally accepts only local-dev aliases. Public-testnet support is disabled until the Sepolia path is wired through Zama official relayer/gateway surfaces.
- `local-fhevm-dev.ts` is server-only and gated by API routes; it creates `PrivateCheckoutSettlement` checkouts with encrypted gross/net/fee inputs plus bucket-owner commitments, finalizes submitted checkout payments, submits merchant-signed local withdraw packages with the Hardhat submitter signer, and finalizes Growth subscription booleans.
- `local-fhevm-browser.ts` is local-dev only; it uses Hardhat/FHEVM mock RPC to create encrypted payment/subscription inputs and decrypt buyer-owned confidential balances.
- `settlement-bucket.ts` keeps bucket derivation single-source so checkout creation and merchant-authorized withdraw read the same encrypted pending balance.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer stays explicit while the local chain-invoice bridge stays localhost-only and non-production.
- Merchant checkout creation belongs to project/API-key backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `wallet.ts` owns injected-wallet account probing, permission revocation, and local chain switching.
