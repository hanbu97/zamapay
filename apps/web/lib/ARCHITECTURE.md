# Web Library Architecture

## Tree

```text
apps/web/lib
|-- amount-format.ts        # Exact minor-unit and ERC20 token amount formatting for merchant-facing balances and fees
|-- api.ts                  # Rust API fetch helpers and DTOs
|-- contract-environment.ts # Manifest, chain, and wallet environment map
|-- contracts.ts            # Generated ABI/address bridge and chain definitions
|-- demo-dashboard.ts       # Single public demo project id and merchant-console link contract
|-- dev-signer-gate.ts      # Pure environment gates for local browser signer, local bridge, and project-key Sepolia bridge
|-- local-fhevm-browser.ts  # Browser Hardhat/FHEVM mock RPC bridge for encrypted checkout and subscription inputs
|-- local-fhevm-dev.ts      # Server-only Hardhat FHEVM mock bridge for checkout, withdraw submission, and subscription finalization
|-- merchant-portal.ts      # Protected billing/project loader and failure mapping
|-- payment-rails.ts        # Merchant-facing payment rail labels, truth-source copy, and project setting defaults
|-- project-amounts.ts      # Project-aware amount labels that bind checkout, balance, fee, and ERC20 asset symbols
|-- runtime-profile.ts      # Typed reader for env/runtime-profiles.json, URL defaults, and finality policy
|-- rust-api-transport.ts   # Server route helper for Rust API URL building, proxy responses, and JSON POST errors
|-- sepolia-fhevm-server.ts # Server-only Sepolia invoice creator using Zama official relayer encryption and checkout-creator signing
|-- settlement-bucket.ts    # Deterministic settlement bucket commitment helper shared by invoice and withdraw flows
|-- time-format.ts          # Merchant-facing timestamp formatting with unambiguous midnight display
|-- utils.ts                # shadcn className merge helper
|-- wallet.ts               # Browser wallet account/session helpers and chain switch/add helper
`-- zama-relayer-browser.ts # Browser Sepolia bridge for Zama official test relayer encryption and public decrypt
```

## Decisions

- API helpers are transport-only; they do not invent payment truth, ERC20 asset support, receiver availability, project authority, webhook secret lifecycle, delivery state, fulfillment release truth, subscription entitlement, or billing math.
- `amount-format.ts` is the only UI formatting source for token minor units; it preserves six-decimal merchant-net and fee precision instead of rounding small values into false whole-token amounts.
- `project-amounts.ts` is the only project-level formatter that infers cUSDT/USDT/USDC/mixed labels from checkout intents and ERC20 balances; UI components render those labels instead of guessing from local table context.
- `payment-rails.ts` is the only frontend source for rail names, short labels, receiving copy, and old-project default settings; merchant screens do not hardcode private-vs-ERC20 wording.
- Project secret dialogs expose the generated `ZAMAPAY_SECRET_KEY` directly; project id and webhook verifier context are bootstrapped by the merchant backend from the Rust API instead of being base64-packed in the browser.
- Contract ABIs and billing/address manifests flow from `generated/clients/ts` so UI writes and public pricing follow compiled Solidity/deploy output.
- `demo-dashboard.ts` is the only browser-safe source for the public demo project id; `NEXT_PUBLIC_DEMO_DASHBOARD_PROJECT_ID` may override the default without widening normal account auth.
- `runtime-profile.ts` owns the deploy/runtime vocabulary. `contract-environment.ts`, chain metadata, wallet metadata, API base URLs, and finality policy derive from the shared env profile contract.
- `rust-api-transport.ts` is the only Next route transport helper for Rust API proxying; routes describe paths and policy, not repeated header/body/response plumbing.
- `local-fhevm-dev.ts` is server-only and gated by API routes; it creates `PrivateCheckoutSettlement` checkouts with encrypted gross/net/fee inputs plus bucket-owner commitments, finalizes submitted checkout payments, submits merchant-signed local withdraw packages with the Hardhat submitter signer, and finalizes Growth subscription booleans.
- `local-fhevm-browser.ts` is local-dev only; it uses Hardhat/FHEVM mock RPC to create encrypted payment/subscription inputs and decrypt buyer-owned confidential balances.
- `zama-relayer-browser.ts` is Sepolia only; it uses `@zama-fhe/relayer-sdk/web` with `SepoliaConfig`, which points at Zama's official test relayer, and never talks to Hardhat mock RPC methods.
- `sepolia-fhevm-server.ts` is server-only and project-secret gated by the route; it creates Sepolia private checkouts with the immutable checkout creator key, while buyer payment and balance decrypt stay in the browser wallet flow.
- `settlement-bucket.ts` keeps bucket derivation single-source so checkout creation and merchant-authorized withdraw read the same encrypted pending balance.
- `dev-signer-gate.ts` is pure and unit-tested so the local browser signer stays explicit, the local bridge stays localhost-only, and production Sepolia bridge calls must carry the existing project secret for Rust API validation.
- Merchant checkout creation belongs to project-secret backends, not dashboard browser wallet helpers; the web app exposes project config and hosted checkout pages.
- `wallet.ts` owns injected-wallet account probing, permission revocation, and wallet chain switching.
