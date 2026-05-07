# Web Library Architecture

## Tree

```text
apps/web/lib
|-- api.ts                          # Rust API fetch helpers and payment-project DTOs
|-- contracts.ts                    # Generated ABI bridge and local chain definition
|-- dev-signer-gate.ts              # Pure environment gate for local browser signer
|-- fhevm.ts                        # Client-only Zama relayer encryption, public decrypt, and user decrypt helper
|-- merchant-portal.ts              # Protected project loader that maps auth failures to login and backend failures to UI state
|-- operator.ts                     # Server-only operator diagnostics fetch boundary
|-- utils.ts                        # shadcn className merge helper
`-- wallet.ts                       # Browser wallet provider guard, chain metadata, and switch/add helper
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, project authority, delivery state, or fulfillment release truth.
- `getSession` and `getOptionalSession` fail closed: unavailable Rust auth means anonymous UI or login redirect, not protected content or a framework crash.
- Contract ABIs flow from `generated/clients/ts` so UI writes follow compiled Solidity.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer cannot silently widen into Sepolia, production, or remote-host contexts.
- FHEVM logic is dynamically loaded on payment action, keeping the relayer SDK out of server render and initial page load.
- Merchant checkout creation belongs to project/API-key backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `merchant-portal.ts` is the server-side boundary for protected project pages: unauthorized means redirect to login; unavailable means render an operational state.
- Merchant decrypt helpers generate the relayer keypair, prepare the Zama EIP-712 request, and return only the wallet-authorized decrypted settlement amount to the client component.
- `wallet.ts` owns injected-wallet chain switching so local-dev and Sepolia browser flows fail before writes when the wallet is on the wrong chain.
- `operator.ts` keeps operator credentials server-side, refuses Sepolia diagnostics when the key is missing or still the local default, and transports webhook/decrypt guard counters without client-side secrets.
- `utils.ts` is intentionally tiny: it only merges Tailwind/shadcn classes, keeping visual composition declarative at call sites.
