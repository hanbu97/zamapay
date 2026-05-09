# Web Library Architecture

## Tree

```text
apps/web/lib
|-- api.ts                  # Rust API fetch helpers and local-dev DTOs
|-- contract-environment.ts # Local-dev manifest, chain, and wallet environment map
|-- contracts.ts            # Generated ABI/address bridge and local chain definition
|-- dev-signer-gate.ts      # Pure environment gate for local browser signer
|-- local-fhevm-dev.ts      # Server-only Hardhat FHEVM mock bridge for checkout, Growth, and wallet balance
|-- merchant-portal.ts      # Protected billing/project loader and failure mapping
|-- utils.ts                # shadcn className merge helper
`-- wallet.ts               # Browser wallet account/session helpers and local chain switch/add helper
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, project authority, delivery state, fulfillment release truth, subscription entitlement, or billing math.
- Contract ABIs and billing/address manifests flow from `generated/clients/ts` so UI writes and public pricing follow compiled Solidity/deploy output.
- `contract-environment.ts` intentionally accepts only local-dev aliases. Public-testnet support is disabled until protocol-fee and relayer funding are designed.
- `local-fhevm-dev.ts` is server-only and gated by API routes; it creates `PrivateCheckoutSettlement` checkouts, manages `MockConfidentialPaymentRail` balances, decrypts only local `accepted` booleans, and runs local Growth subscription proofs.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer cannot silently widen into production, public testnet, or remote-host contexts.
- Merchant checkout creation belongs to project/API-key backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `wallet.ts` owns injected-wallet account probing, permission revocation, and local chain switching.
