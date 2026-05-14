# Web Architecture

## Tree

```text
apps/web
|-- app/
|   |-- docs/                         # Public integration docs
|   |-- login/page.tsx                 # Dedicated wallet sign-in page
|   |-- checkout/[invoiceId]/page.tsx  # Standalone buyer hosted checkout
|   |-- api/billing/project-growth/route.ts
|   |-- api/checkout/project-finalized-payment/route.ts
|   |-- api/dev/sign-message/route.ts
|   |-- api/dev/project-local-growth/route.ts
|   |-- api/dev/local-chain-invoice/route.ts
|   |-- page.tsx
|   `-- (merchant)/
|       |-- layout.tsx
|       |-- billing/page.tsx
|       |-- billing/upgrade/page.tsx
|       |-- merchant/page.tsx
|       |-- merchant/[projectId]/page.tsx
|       |-- ops/page.tsx
|       `-- dashboard/page.tsx
|-- components/
|   |-- auth/LoginCard.tsx
|   |-- checkout/CheckoutPaymentCard.tsx
|   |-- commerce/
|   |-- landing/
|   |-- layout/
|   |-- merchant/
|   |-- reui/
|   `-- ui/
|-- hooks/
|-- lib/
|-- next.config.ts                   # Next runtime/build configuration, including docs content tracing
|-- public/
|   |-- tfhe_bg.wasm
|   |-- kms_lib_bg.wasm
|   |-- workerHelpers.js
|   `-- landing/
|-- tests/
|-- e2e/
|-- scripts/
|   |-- create-sepolia-chain-invoice.mjs
|   `-- run-e2e.mjs
`-- app/globals.css
```

## Decisions

- Server components guard protected pages by consulting Rust session state.
- `/login` is standalone; expired or missing sessions do not inherit merchant chrome.
- Hosted checkout renders from Rust public checkout APIs in a standalone buyer shell and uses one centered payment card for either Zama private payment or ordinary ERC20 settlement intent; EVM pages consume the intent-specific asset from that same public checkout response so the buyer pays the indexed settlement contract.
- Contract environments are selected through generated manifests. Local-dev uses Hardhat/FHEVM mock RPC; Sepolia uses deployed public-testnet manifests, wallet chain id `11155111`, and Zama official test relayer SDK calls for encrypted inputs and public decrypts.
- Production builds use webpack because the current Zama browser SDK/WASM chunk stalls under Next 16 Turbopack during optimized builds.
- Public docs content is Markdoc under repo-root `docs/content/public`; `next.config.ts` traces those Markdown files into server output because the shared public header and docs routes load route metadata at runtime.
- `app/api/billing/project-growth` verifies configured-chain `SubscriptionChangeFinalized` evidence, then projects the anchored entitlement into Rust.
- `app/api/checkout/project-finalized-payment` verifies a supplied finalization transaction on the configured chain or finalizes a submitted local-dev checkout server-side, then calls Rust projection and confirmation endpoints.
- `app/api/dev/project-local-growth` is the local-dev-only server finalization shim for Growth subscriptions.
- `app/api/dev/local-private-withdraw` is a local-dev submitter shim for merchant-signed withdraw packages; Sepolia must use Zama/chain relayer surfaces, not a ZamaPay platform relayer.
- `scripts/create-sepolia-chain-invoice.mjs` is a local demo worker for Sepolia checkout creation; it keeps native Zama relayer WASM loading out of the Next route bundle.
- Local confidential cUSDT balances are read by buyer-facing browser UI from Hardhat/FHEVM mock RPC, not through ZamaPay backend balance projections.
- The old platform relayer route, old local confidential-payment routes, public-testnet branches, and dashboard settlement decrypt card are removed from the active web app.
- Merchant checkout creation is project/API-key driven from external merchant backends; the web console manages projects, keys, webhook endpoints, sessions, billing, hosted checkout URLs, balance activity, and merchant-signed encrypted withdraw projection.
- UI primitives come from shadcn/Base UI/ReUI/lucide; business screens compose these primitives instead of inventing local widget styles.
