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
|   |-- api/checkout/project-finalized-payment/route.ts
|   |-- page.tsx                    # Public Mermer Pay website home with session-aware entry buttons
|   `-- (merchant)/
|       |-- layout.tsx              # Session-aware merchant shadcn sidebar/topbar shell
|       |-- merchant/page.tsx       # Protected payment project and integration overview
|       |-- ops/page.tsx            # Protected server-side operator diagnostics console
|       |-- dashboard/page.tsx      # Protected hosted checkout/payment workspace
|       `-- checkout/[invoiceId]/page.tsx
|-- public/landing/
|   `-- merchant-console.png        # Website hero product preview
|-- components/
|   |-- auth/LoginCard.tsx          # Wallet connect + nonce/signature flow
|   |-- checkout/CheckoutPaymentCard.tsx
|   |-- commerce/StatusBadge.tsx    # Shared status badge policy
|   |-- dashboard/SettlementDecryptCard.tsx
|   |-- landing/LandingProductMotion.tsx
|   |-- layout/AppSidebar.tsx       # shadcn sidebar navigation shell
|   |-- layout/PageHeader.tsx       # Shared page heading/action composition
|   |-- layout/TopBar.tsx           # Breadcrumb and top actions
|   `-- ui/                         # shadcn/base-nova primitives; no business state
|-- hooks/
|   `-- use-mobile.ts               # shadcn responsive sidebar helper
|-- lib/
|   |-- api.ts                      # Backend fetch helpers
|   |-- contracts.ts                # Generated contract ABI bridge and local chain config
|   |-- dev-signer-gate.ts          # Local-only signer environment gate
|   |-- fhevm.ts                    # Client-only Zama relayer encryption helper
|   |-- operator.ts                 # Server-side operator diagnostics fetch boundary
|   |-- merchant-portal.ts          # Server-side project loader that separates auth redirect from API unavailability
|   |-- utils.ts                    # shadcn className merge helper
|   `-- wallet.ts                   # Browser wallet capability helpers
|-- tests/
|   `-- dev-signer-gate.test.ts     # Unit coverage for local signer boundary
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
- Payment pages and hosted checkout render from Rust read-model APIs, so later chain projection can replace seed data without reworking page boundaries.
- Payments workspace reads the generated contract manifest through Rust, which keeps contract network and address truth out of ad hoc frontend constants.
- `NEXT_PUBLIC_CONTRACT_ENV` selects the manifest environment; default `local-dev` keeps local smoke stable while `sepolia` unlocks browser relayer payment.
- Checkout reads payment, finality, release-gate, and webhook state from Rust; it does not display merchant-template fulfillment artifacts.
- Merchant checkout creation is project/API-key driven from external merchant backends; the web console manages projects, keys, webhook endpoints, sessions, and diagnostics.
- Merchant project pages route unauthorized API responses back to `/login` and render an explicit API-unavailable state for missing/stale local backends instead of throwing framework overlays.
- `SettlementDecryptCard` keeps merchant plaintext settlement viewing wallet-bound; it reads the encrypted handle from the settlement contract and asks the relayer for user decrypt only after an EIP-712 wallet signature.
- `/` is the public Mermer Pay website home; `/merchant` is the protected merchant console project home.
- `/docs` is public and documents the merchant project loop, API-key checkout boundary, webhook verification, CardForge configuration, and environment proof.
- The public homepage uses a single landing client island for motion/step interaction; merchant payment writes remain outside the landing surface.
- Merchant chrome lives in `app/(merchant)/layout.tsx`, so the public website does not inherit dashboard sidebar or topbar.
- External merchant applications live outside `apps/web`; the platform app only exposes project config and hosted checkout surfaces.
- Checkout payment uses a client-only Zama relayer helper so encrypted input generation and public decrypt never run during server rendering or initial static module load.
- `app/api/checkout/project-finalized-payment` is the server-side operator bridge for browser checkout: it verifies `InvoicePaid` on the current settlement contract before calling Rust projection and confirmation endpoints.
- `/ops` is the protected server-side operator console; it can hold the operator key and renders finality, decrypt, webhook, fulfillment, and reorg queues without exposing diagnostics before login.
- `app/api/dev/sign-message` is deliberately gated by `lib/dev-signer-gate.ts`; it exists for local browser verification only and stays off unless explicitly enabled.
- Invoice amount is created once by the merchant and carried through Rust DTOs, chain invoices, checkout display, confidential approval, and confidential settlement.
- UI primitives come from the latest shadcn CLI using `base-nova`, Base UI, lucide icons, and neutral CSS variables; business screens compose these primitives instead of inventing local widget styles.
- The root layout contains only HTML/font concerns; merchant templates remain outside the platform app.
- Pages use shadcn `SidebarProvider`, `Sidebar`, `SidebarInset`, breadcrumb topbar, tabs, dropdown menu, input group, select, item, button-group, table, alert, and card primitives so the product reads as a professional merchant console instead of page-local card grids.
- `next.config.ts` disables the Next dev indicator because screenshot-driven product QA should inspect Mermer chrome, not framework overlay controls.
- Tailwind v4 is wired through PostCSS and `app/globals.css`; semantic tokens such as card, border, muted, and primary are the only color contract page code should rely on.
- `TooltipProvider` lives in the merchant layout because tooltip behavior belongs to console chrome, not the public homepage.
