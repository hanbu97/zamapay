# Web Library Architecture

## Tree

```text
apps/web/lib
|-- api.ts                          # Rust API fetch helpers, subscription DTOs, billing snapshots, and project DTOs
|-- contract-environment.ts         # Canonical dev/test contract environment map for manifests, chains, wallets, and browser relayer gates
|-- contracts.ts                    # Generated ABI/address bridge and local chain definition
|-- dev-signer-gate.ts              # Pure environment gate for local browser signer
|-- fhevm.ts                        # Client-only Zama relayer payment/subscription encryption, public decrypt, and user decrypt helpers
|-- local-fhevm-dev.ts              # Server-only Hardhat FHEVM mock bridge for local chain invoices, encrypted inputs, boolean decrypt, and wallet balance projection
|-- merchant-portal.ts              # Protected billing/project loader that maps auth failures to login and backend failures to UI state
|-- utils.ts                        # shadcn className merge helper
`-- wallet.ts                       # Browser wallet account/session helpers, chain metadata, and switch/add helper
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, project authority, delivery state, fulfillment release truth, subscription entitlement, or billing math.
- Billing helpers expose catalog/read-model data from Rust; paid subscription entitlement is read by wallet-bound UI code from the chain, not chosen by API responses.
- `getSession`, `getOptionalSession`, and `logoutSession` keep auth state owned by the Rust `mermer_session` boundary; unavailable auth means anonymous UI, login redirect, or a failed logout action rather than invented client truth.
- Contract ABIs and billing/address manifests flow from `generated/clients/ts` so UI writes and public pricing follow compiled Solidity/deploy output.
- `contract-environment.ts` is the single frontend map: `local-dev` means Hardhat/local manifest plus dev FHEVM mock bridge; `sepolia` means public testnet manifest and wallet-bound Zama relayer flows.
- `local-fhevm-dev.ts` is server-only and gated by API routes; it never creates a public ERC20 payment rail, only local settlement invoices, encrypted handles, local `accepted` boolean decrypts, and app-rendered confidential wallet balances.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer cannot silently widen into Sepolia, production, or remote-host contexts.
- FHEVM logic is dynamically loaded on payment or subscription action: the browser first loads the static Zama UMD bundle from `public`, then imports the SDK `bundle` shim after `window.relayerSDK` exists.
- Merchant checkout creation belongs to project/API-key backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `merchant-portal.ts` is the server-side boundary for protected billing and project pages: unauthorized means redirect to login; unavailable means render an operational state.
- Merchant decrypt helpers generate the relayer keypair, prepare the Zama EIP-712 request, and return only wallet-authorized decrypted settlement amount or subscription terms to the client component.
- `wallet.ts` owns injected-wallet account probing, permission revocation, and chain switching; login consumes one active wallet-returned account and leaves account switching to the wallet before reconnect.
- `utils.ts` is intentionally tiny: it only merges Tailwind/shadcn classes, keeping visual composition declarative at call sites.
