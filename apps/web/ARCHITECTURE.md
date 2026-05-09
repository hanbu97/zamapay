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
|   |-- api/dev/local-private-checkout/pay/route.ts
|   |-- api/dev/local-confidential-wallet/route.ts
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
- Local-dev is the only active contract environment. The checkout client signs a local private intent, then the server relayer submits and finalizes `PrivateCheckoutSettlement`.
- `app/api/checkout/project-finalized-payment` verifies only `PrivatePaymentFinalized` from `PrivateCheckoutSettlement`, then calls Rust projection and confirmation endpoints.
- `app/api/dev/project-local-growth` executes the local chain `PrivateSubscriptionRegistry` Growth proof before projecting the account subscription.
- `app/api/dev/local-confidential-wallet` exposes the app-rendered confidential cUSDT balance because the mock cUSDT balance is not a MetaMask ERC20 token.
- The old browser Zama relayer bundle, old local confidential-payment routes, public-testnet branches, and dashboard settlement decrypt card are removed from the active web app.
- Merchant checkout creation is project/API-key driven from external merchant backends; the web console manages projects, keys, webhook endpoints, sessions, diagnostics, billing, and hosted checkout URLs.
- UI primitives come from shadcn/Base UI/ReUI/lucide; business screens compose these primitives instead of inventing local widget styles.
