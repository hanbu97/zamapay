# Web Library Architecture

## Tree

```text
apps/web/lib
|-- api.ts                  # Rust API fetch helpers and DTOs
|-- contract-environment.ts # Manifest, chain, and wallet environment map
|-- contracts.ts            # Generated ABI/address bridge and chain definitions
|-- dev-signer-gate.ts      # Pure environment gates for local browser signer and local server bridge
|-- local-fhevm-browser.ts  # Browser Hardhat/FHEVM mock RPC bridge for encrypted checkout and subscription inputs
|-- local-fhevm-dev.ts      # Server-only Hardhat FHEVM mock bridge for checkout, withdraw submission, and subscription finalization
|-- merchant-portal.ts      # Protected billing/project loader and failure mapping
|-- sepolia-fhevm-server.ts # Server-only Sepolia invoice creator using Zama official relayer encryption and checkout-creator signing
|-- settlement-bucket.ts    # Deterministic settlement bucket commitment helper shared by invoice and withdraw flows
|-- time-format.ts          # Merchant-facing timestamp formatting with unambiguous midnight display
|-- utils.ts                # shadcn className merge helper
|-- wallet.ts               # Browser wallet account/session helpers and chain switch/add helper
`-- zama-relayer-browser.ts # Browser Sepolia bridge for Zama official test relayer encryption and public decrypt
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, project authority, delivery state, fulfillment release truth, subscription entitlement, or billing math.
- Contract ABIs and billing/address manifests flow from `generated/clients/ts` so UI writes and public pricing follow compiled Solidity/deploy output.
- `contract-environment.ts` owns the allowed environment vocabulary. `local-dev` and `sepolia` resolve to generated manifests, wallet chain metadata, and project environment values.
- `local-fhevm-dev.ts` is server-only and gated by API routes; it creates `PrivateCheckoutSettlement` checkouts with encrypted gross/net/fee inputs plus bucket-owner commitments, finalizes submitted checkout payments, submits merchant-signed local withdraw packages with the Hardhat submitter signer, and finalizes Growth subscription booleans.
- `local-fhevm-browser.ts` is local-dev only; it uses Hardhat/FHEVM mock RPC to create encrypted payment/subscription inputs and decrypt buyer-owned confidential balances.
- `zama-relayer-browser.ts` is Sepolia only; it uses `@zama-fhe/relayer-sdk/web` with `SepoliaConfig`, which points at Zama's official test relayer, and never talks to Hardhat mock RPC methods.
- `sepolia-fhevm-server.ts` is server-only and local-development gated by the route; it creates Sepolia private checkouts with the immutable checkout creator key, while buyer payment and balance decrypt stay in the browser wallet flow.
- `settlement-bucket.ts` keeps bucket derivation single-source so checkout creation and merchant-authorized withdraw read the same encrypted pending balance.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer stays explicit while the local chain-invoice bridge stays localhost-only and non-production.
- Merchant checkout creation belongs to project/API-key backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `wallet.ts` owns injected-wallet account probing, permission revocation, and wallet chain switching.
