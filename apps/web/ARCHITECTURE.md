# Web Architecture

## Tree

```text
apps/web
|-- app/
|   |-- docs/                         # Public local-dev integration docs
|   |-- login/page.tsx                 # Dedicated wallet sign-in page
|   |-- checkout/[invoiceId]/page.tsx  # Standalone buyer hosted checkout
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
|-- public/
|   |-- tfhe_bg.wasm
|   |-- kms_lib_bg.wasm
|   |-- workerHelpers.js
|   `-- landing/
|-- tests/
|-- e2e/
|-- scripts/
`-- app/globals.css
```

## Decisions

- Server components guard protected pages by consulting Rust session state.
- `/login` is standalone; expired or missing sessions do not inherit merchant chrome.
- Hosted checkout renders from Rust read-model APIs in a standalone buyer shell and uses one centered private-payment card.
- Local-dev is the only active contract environment. The hosted checkout browser encrypts `paidAmount` and submits one `PrivateCheckoutSettlement` transaction directly with the buyer wallet; the settlement contract credits encrypted merchant/platform pending buckets after finalization.
- `app/api/checkout/project-finalized-payment` either verifies a supplied finalization transaction or finalizes a submitted local-dev checkout server-side, then calls Rust projection and confirmation endpoints.
- `app/api/dev/project-local-growth` receives the browser-submitted Growth request transaction, finalizes the publicly decrypted boolean server-side, then projects the anchored entitlement into Rust.
- `app/api/dev/local-private-withdraw` is a local-dev submitter shim for merchant-signed withdraw packages; Sepolia should swap this submitter for Zama/chain relayer surfaces, not a ZamaPay platform relayer.
- Local confidential cUSDT balances are read by buyer-facing browser UI from Hardhat/FHEVM mock RPC, not through ZamaPay backend balance projections.
- The old platform relayer route, old local confidential-payment routes, public-testnet branches, and dashboard settlement decrypt card are removed from the active web app.
- Merchant checkout creation is project/API-key driven from external merchant backends; the web console manages projects, keys, webhook endpoints, sessions, billing, hosted checkout URLs, balance activity, and merchant-signed encrypted withdraw projection.
- UI primitives come from shadcn/Base UI/ReUI/lucide; business screens compose these primitives instead of inventing local widget styles.
