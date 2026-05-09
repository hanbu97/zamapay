# Web Architecture

## Tree

```text
apps/web
|-- next.config.ts                 # Next runtime config; dev product chrome stays clean
|-- components.json                # shadcn registry, alias, and style contract
|-- postcss.config.mjs             # Tailwind v4 PostCSS bridge
|-- app/
|   |-- layout.tsx                  # Root HTML/font shell only
|   |-- icon.svg                    # Browser tab icon
|   |-- docs/                       # Public integration docs and operation guides
|   |-- login/page.tsx              # Dedicated wallet sign-in page outside merchant chrome
|   |-- checkout/[invoiceId]/page.tsx # Standalone buyer hosted checkout outside merchant chrome
|   |-- api/checkout/project-finalized-payment/route.ts
|   |-- api/dev/sign-message/route.ts
|   |-- api/dev/project-local-growth/route.ts
|   |-- api/dev/local-confidential-wallet/route.ts
|   |-- api/dev/local-confidential-payment/inputs/route.ts
|   |-- api/dev/local-confidential-payment/decrypt/route.ts
|   |-- page.tsx                    # Public Mermer Pay website home with session-aware entry buttons
|   `-- (merchant)/
|       |-- layout.tsx              # Session-aware merchant shadcn sidebar/topbar shell
|       |-- billing/page.tsx        # Protected account subscription status and payment history
|       |-- billing/upgrade/page.tsx # Protected account subscription upgrade flow that reads contract state in-browser
|       |-- merchant/page.tsx       # Protected account-level project inventory and creation
|       |-- merchant/[projectId]/page.tsx # Protected project-level keys, webhooks, payments, and diagnostics
|       |-- ops/page.tsx            # Protected server-side operator diagnostics console
|       `-- dashboard/page.tsx      # Protected all-project payment overview
|-- public/
|   |-- relayer-sdk-js.umd.js       # Zama relayer browser bundle loaded on payment action
|   |-- tfhe_bg.wasm                # Zama TFHE wasm fetched by the relayer bundle
|   |-- kms_lib_bg.wasm             # Zama KMS wasm fetched by the relayer bundle
|   |-- workerHelpers.js            # Zama relayer worker helper
|   `-- landing/
|       `-- merchant-console.png    # Website hero product preview
|-- components/
|   |-- auth/LoginCard.tsx          # Wallet connect + nonce/signature flow with gated local-dev signer
|   |-- checkout/CheckoutPaymentCard.tsx # Centered buyer payment card; Sepolia relayer or local-dev encrypted settlement
|   |-- commerce/StatusBadge.tsx    # Shared status badge policy
|   |-- commerce/StatusStepper.tsx  # Shared read-only process stepper policy
|   |-- dashboard/SettlementDecryptCard.tsx
|   |-- landing/LandingProductMotion.tsx
|   |-- layout/AppSidebar.tsx       # Account/project-aware shadcn sidebar navigation shell
|   |-- layout/PageHeader.tsx       # Shared page heading/action composition
|   |-- layout/TopBar.tsx           # Breadcrumb and top actions
|   |-- merchant/MerchantBillingOverview.tsx # Account subscription status and billing history
|   |-- merchant/MerchantBillingPanel.tsx # Dedicated subscription pricing, comparison, and private payment client
|   |-- merchant/MerchantProjectsOverview.tsx # Account project list and creation client
|   |-- merchant/PaymentProjectConsoleParts.tsx
|   |-- reui/stepper.tsx            # ReUI registry stepper primitive
|   `-- ui/                         # shadcn/base-nova primitives; no business state
|-- hooks/
|   `-- use-mobile.ts               # shadcn responsive sidebar helper
|-- lib/
|   |-- api.ts                      # Backend fetch helpers
|   |-- contract-environment.ts     # Canonical dev/test contract manifest and chain environment map
|   |-- contracts.ts                # Generated contract ABI bridge and local chain config
|   |-- dev-signer-gate.ts          # Local-only signer environment gate
|   |-- fhevm.ts                    # Client-only Zama relayer encryption helper
|   |-- local-fhevm-dev.ts          # Server-only local FHEVM mock bridge for encrypted inputs, boolean decrypt, and wallet projection
|   |-- merchant-portal.ts          # Server-side project loader that separates auth redirect from API unavailability
|   |-- utils.ts                    # shadcn className merge helper
|   `-- wallet.ts                   # Browser wallet capability helpers
|-- tests/
|   |-- contract-environment.test.ts # Unit coverage for local-dev/Sepolia environment aliases
|   |-- dev-signer-gate.test.ts     # Unit coverage for local signer boundary
|   |-- merchant-portal.test.ts     # Unit coverage for protected project loader boundaries
|   `-- wallet-accounts.test.ts     # Unit coverage for injected wallet account parsing
|-- e2e/
|   |-- auth-login.spec.ts          # Live auth and route-guard proof
|   |-- checkout-flow.spec.ts       # Live local checkout projection and artifact proof
|   |-- operator-failure-drills.spec.ts
|   `-- support/                    # Shared e2e HTTP and wallet-login helpers
|-- scripts/
|   `-- run-e2e.mjs                 # Serial runner for named local e2e specs
`-- app/globals.css                 # Product-level styling
```

## Decisions

- Server components guard protected pages by consulting Rust session state.
- Public and merchant chrome use the same session truth: anonymous users see login, while dashboard, console, and diagnostics entries appear only after wallet sign-in.
- `/login` is a dedicated standalone route: expired or missing sessions land there without inheriting merchant sidebar/topbar chrome.
- `allowImportingTsExtensions` is enabled because Node's built-in test runner executes TypeScript test files directly under no-emit type checking.
- `test:e2e` uses a small serial Node runner against live local services; it intentionally avoids a new browser-test dependency while locking the RALPLAN command matrix, operator failure drills, and nonce-race prevention.
- `e2e/support` centralizes live-service HTTP and wallet login mechanics; specs keep scenario assertions local instead of copying clients.
- Client auth logic is isolated in `LoginCard.tsx`; it requests nonce, signs, then hands verification to Rust.
- Login silently reads already-authorized wallet accounts with `eth_accounts`; explicit connect is only used when the browser has a wallet but no project-approved account yet.
- Hosted checkout renders from Rust read-model APIs in a standalone buyer shell, so dashboard chrome cannot leak into the payment experience.
- Payments workspace reads the generated contract manifest through Rust, which keeps contract network and address truth out of ad hoc frontend constants.
- `NEXT_PUBLIC_CONTRACT_ENV` selects the manifest environment; default `local-dev` keeps local smoke stable while `sepolia` unlocks browser relayer payment.
- Checkout keeps merchant order identity inside one centered card; buyer-facing payment hides chain invoice, platform fee, merchant net, and finality depth while still paying the canonical read-model amount.
- Checkout progress uses `commerce/StatusStepper` in horizontal active-detail mode, while merchant setup keeps the vertical all-detail mode.
- Merchant console spacing is defined once in `app/globals.css` through `--mermer-*` tokens; page shells, cards, dialogs, section grids, and steppers consume those tokens instead of page-local gap guesses.
- `/merchant` is account scope for project inventory and new-project onboarding only; subscription and aggregate payment health live on separate account pages.
- `/billing` is account scope for current subscription read-model and subscription payment history; `/billing/upgrade` owns monthly/annual selection, private upgrade payment, RPC-backed `PrivateSubscriptionRegistry` reads, and wallet-bound decrypt/write actions.
- `/merchant/[projectId]` is project scope: API keys, webhook endpoints, project checkout sessions, and diagnostics live there.
- Merchant checkout creation is project/API-key driven from external merchant backends; the web console manages projects, keys, webhook endpoints, sessions, and diagnostics without importing demo state.
- Merchant project pages route unauthorized API responses back to `/login` and render an explicit API-unavailable state for missing/stale local backends instead of throwing framework overlays.
- `SettlementDecryptCard` and subscription upgrade keep plaintext values wallet-bound; both read encrypted handles from contracts and ask the relayer for user decrypt only after an EIP-712 wallet signature.
- `/` is the public Mermer Pay website home; `/merchant` is the protected account projects home.
- `/docs` is public and documents the merchant project loop, API-key checkout boundary, webhook verification, CardForge configuration, and environment proof.
- The public homepage uses a single landing client island for motion/step interaction; merchant payment writes remain outside the landing surface.
- Merchant chrome lives in `app/(merchant)/layout.tsx`, so the public website does not inherit dashboard sidebar or topbar.
- External merchant applications live outside `apps/web`; the platform app only exposes project config and hosted checkout surfaces.
- Checkout payment and subscription upgrade use a client-only Zama relayer helper plus static public wasm/worker assets so encrypted input generation, public decrypt, and user decrypt never run during server rendering or initial static module load.
- `app/api/checkout/project-finalized-payment` is the server-side operator bridge for browser checkout: it verifies `InvoicePaid`, reads optional split-fee evidence, then calls Rust projection and confirmation endpoints.
- `app/api/dev/sign-message` is deliberately gated by `lib/dev-signer-gate.ts`; it exists for local browser verification only and stays off unless explicitly enabled.
- `app/api/dev/project-local-growth` projects Growth entitlement for local browser QA; `app/api/dev/local-confidential-*` keeps local browser checkout on the confidential path by generating local FHEVM mock encrypted inputs, decrypting only the paid/rejected boolean, and projecting finalized `InvoicePaid` through the normal operator bridge.
- Project diagnostics include local withdraw recording against paid merchant net; it is a read-model payout reconciliation path, not the future Sepolia private withdraw contract.
- Invoice amount is created once by the merchant and carried through Rust DTOs, chain invoices, checkout display, confidential approval, and confidential settlement.
- UI primitives come from the latest shadcn CLI using `base-nova`, Base UI, ReUI, lucide icons, and neutral CSS variables; business screens compose these primitives instead of inventing local widget styles.
- The root layout contains only HTML/font concerns; merchant templates remain outside the platform app.
- Pages use shadcn `SidebarProvider`, `Sidebar`, `SidebarInset`, breadcrumb topbar, tabs, dropdown menu, input group, select, item, button-group, table, alert, and card primitives so the product reads as a professional merchant console instead of page-local card grids.
- `next.config.ts` disables the Next dev indicator because screenshot-driven product QA should inspect Mermer chrome, not framework overlay controls.
- Tailwind v4 is wired through PostCSS and `app/globals.css`; semantic tokens such as card, border, muted, and primary are the only color contract page code should rely on.
- `TooltipProvider` lives in the merchant layout because tooltip behavior belongs to console chrome, not the public homepage.
