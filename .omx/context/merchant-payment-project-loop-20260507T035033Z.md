## Task Statement

Plan the missing Mermer Pay merchant-payment endpoints and UI interactions so the platform can support a real hosted-checkout loop:

1. A merchant creates a payment project.
2. The project exposes configuration keys and webhook settings.
3. An independent merchant template, currently CardForge, starts from that configuration.
4. The merchant template creates a hosted checkout through Mermer Pay.
5. The buyer pays on the hosted checkout.
6. Mermer Pay projects payment/finality truth, signs and delivers the project webhook, and the merchant dashboard shows correct state and statistics.

This is a `$ralplan` run. Produce a consensus implementation plan; do not implement in this planning pass.

## Desired Outcome

- A concrete endpoint plan for Rust API, storage, shared DTOs, Next.js server/client API wrappers, and CardForge integration.
- A clear merchant console information architecture: projects, project settings, API keys, webhook endpoint, test webhook, checkout links, payments, events, and diagnostics.
- A clean separation between Mermer Pay and `demo/cardforge`: CardForge remains a standalone merchant template, not a feature inside the payment platform.
- A verification path proving the browser-visible loop: project creation -> config handoff -> CardForge checkout creation -> hosted checkout payment/projection -> signed webhook -> merchant dashboard status and stats.
- A plan that keeps the UI simple: primary actions first, secondary diagnostics tucked away.

## Current Codebase Facts

- `crates/shared/src/lib.rs` has auth/session DTOs, invoice DTOs, dashboard DTOs, webhook dispatch DTOs, and operator diagnostics, but no `PaymentProject`, API key, webhook endpoint, checkout-session, webhook-event, or delivery-log model.
- `crates/api/src/lib.rs` currently exposes:
  - `POST /api/auth/nonce`
  - `POST /api/auth/verify`
  - `GET /api/session`
  - `GET /api/dashboard/overview`
  - `POST /api/invoices`
  - `GET /api/invoices/{invoice_id}`
  - invoice fulfillment/decrypt endpoints
  - operator projection/diagnostic/webhook-dispatch endpoints
- `crates/api/src/lib.rs` signs webhook dispatches with a global `MERMER_WEBHOOK_SECRET` and sends them to a global `MERMER_WEBHOOK_ENDPOINT`; the endpoint is not project-specific.
- `crates/storage/src/lib.rs` stores invoices in `InMemoryPortalStore` with optional JSON persistence. It has no project store, no API-key store, no webhook endpoint store, no idempotency index, and no delivery history beyond the invoice's current webhook snapshot.
- `apps/web/lib/api.ts` mirrors only session, manifest, dashboard, invoice, fulfillment, and create-invoice calls.
- `apps/web/app/(merchant)/merchant/page.tsx` is a static "Payment projects" page with hardcoded `Default merchant project` and `/webhooks/mermer-pay`.
- `apps/web/app/(merchant)/dashboard/page.tsx` shows invoices, create checkout, decrypt, and contracts. It has no project settings, API key, webhook testing, checkout-link creation, delivery logs, or project-specific filtering.
- `apps/web/components/dashboard/CreateInvoiceForm.tsx` creates a checkout by asking the merchant wallet to create a chain invoice, then creates/projects a backend invoice. This is useful for direct platform smoke tests, but it is not the merchant API flow used by an external store.
- `apps/web/components/checkout/CheckoutPaymentCard.tsx` requires a non-null `chainInvoiceId`, a Sepolia manifest, settlement address, and token address before buyer payment is enabled.
- `demo/cardforge/backend/src/main.rs` is standalone and reads `MERMER_PAY_PROJECT_ID`, `MERMER_PAY_API_URL`, `MERMER_PAY_CHECKOUT_BASE_URL`, `CARDFORGE_WEBHOOK_ENDPOINT`, and display labels from env.
- `demo/cardforge/backend/src/main.rs` currently calls `POST /api/invoices` with a forwarded merchant session cookie. It does not authenticate with a project API key and sends `chain_invoice_id: None`, so the returned hosted checkout is not browser-payable.
- Current manual smoke evidence from the previous browser/API run: CardForge can create an invoice and redirect to Mermer hosted checkout, but the checkout remains "not projected" / "Sepolia manifest required"; operator projection and webhook delivery can be forced manually with `local-operator-dev-key`, but project-specific automatic delivery is missing.

## External Payment Platform Patterns

- Infini hosted checkout reduces merchant integration to three operations: create order, redirect to `checkout_url`, handle webhook. Its API uses merchant-generated `request_id` for idempotency, returns `order_id` plus `checkout_url`, supports query order, and has token reissue for expired checkout URLs.
- Infini webhook docs model order states as pending, processing, paid, partial paid, expired, and late payment. They require event id based idempotency, HMAC-SHA256 signatures, quick HTTP 200 responses, and retry/backoff.
- Cryptomus invoice creation takes amount/currency/order_id plus `url_return`, `url_success`, `url_callback`, lifetime, and payment-tolerance fields. It treats `order_id` as unique and returns an invoice/payment URL plus status fields.
- Cryptomus webhook payload includes merchant order id, amount, payment status, finality flag, network, payer details, tx id, and signature. It also supports webhook test and resend flows.
- Coinbase Payment Acceptance exposes resources for payments, operators, webhooks, webhook events, and webhook deliveries. Webhook creation returns a secret, reinforcing that webhook endpoints are first-class project resources, not a global env string.
- Stripe Checkout keeps checkout session creation server-side and recommends webhook-backed fulfillment because redirect/landing-page fulfillment alone is not guaranteed.

## Constraints

- Backend remains Rust. Frontend remains latest Next.js App Router with existing shadcn-style components.
- Do not merge demo merchant UX into Mermer Pay. `demo/cardforge` must stay standalone and consume platform configuration through env/config.
- No broad dependency additions unless the implementation truly needs them.
- Secrets must be generated once, displayable/copyable at creation or rotation time, then stored only as hashes where practical.
- Zama/FHEVM must stay central to the payment value proposition; this should not collapse into a public mock gateway.
- The plan must preserve current working login, dashboard, operator projection, and checkout payment surfaces while moving them behind cleaner project/payment abstractions.
- This workspace currently is not a git repository at the inspected root, so planning and later verification must rely on command evidence rather than `git status`.

## Unknowns / Open Questions

- Whether the execution pass should prioritize "browser payment on Sepolia" or "operator-simulated local closed loop" first. The practical plan should support both lanes but make local deterministic loop the first CI proof.
- Whether API-key authenticated merchant checkout creation should also support cookie-authenticated console creation. Likely yes, but separate endpoint roles are needed.
- Whether project API secrets should be encrypted-at-rest in the hackathon implementation or stored as keyed hashes only. For MVP, keyed hash plus one-time reveal is likely enough.
- Whether "refund/withdrawal" belongs in this milestone. Mature platforms expose it, but it is probably out of scope for the first closed loop.

## Likely Codebase Touchpoints

- `crates/shared/src/lib.rs`
- `crates/storage/src/lib.rs`
- `crates/api/src/lib.rs`
- `crates/storage/tests/portal_store.rs`
- `apps/web/lib/api.ts`
- `apps/web/app/(merchant)/merchant/page.tsx`
- `apps/web/app/(merchant)/dashboard/page.tsx`
- `apps/web/components/dashboard/CreateInvoiceForm.tsx`
- `apps/web/components/checkout/CheckoutPaymentCard.tsx`
- `apps/web/app/(merchant)/checkout/[invoiceId]/page.tsx`
- `apps/web/app/(merchant)/ops/page.tsx`
- `demo/cardforge/backend/src/main.rs`
- `demo/cardforge/frontend/components/cardforge/CreateCheckoutButton.tsx`
- `apps/web/e2e/checkout-flow.spec.ts`
- `apps/web/e2e/operator-failure-drills.spec.ts`
- Architecture docs under changed directories, especially `crates/*/ARCHITECTURE.md`, `apps/web/app/(merchant)/**/ARCHITECTURE.md`, and demo docs if file boundaries move.

## Planning Risks

- Keeping one global merchant/project and one global webhook endpoint would make the demo pass but leave the product architecture wrong.
- Letting CardForge continue to create invoices with a merchant browser session would hide the real API-key integration problem.
- Adding too many dashboard cards would repeat the current UI issue; the console must show one primary project action at a time.
- Implementing webhook dispatch as an on-demand operator GET only proves signature generation, not platform-owned delivery and retry semantics.
- Trying to ship refunds, payouts, subscriptions, and multi-token settlement in the same slice would bury the core checkout loop.

## Research Sources

- Infini hosted checkout: https://developer.infini.money/docs/en/3-checkout-mode
- Infini hosted checkout API: https://developer.infini.money/docs/en/6-api-ducumentation
- Infini webhook model: https://developer.infini.money/docs/en/7-webhook
- Cryptomus invoice creation: https://doc.cryptomus.com/merchant-api/payments/creating-invoice
- Cryptomus webhook: https://doc.cryptomus.com/merchant-api/payments/webhook
- Cryptomus resend/test webhook: https://doc.cryptomus.com/merchant-api/payments/resend-webhook and https://doc.cryptomus.com/merchant-api/payments/testing-webhook
- Coinbase Payment Acceptance overview/webhooks: https://docs.cdp.coinbase.com/api-reference/payment-acceptance/overview and https://docs.cdp.coinbase.com/api-reference/payment-acceptance/webhooks/create-webhook
- Stripe Checkout Sessions and fulfillment: https://docs.stripe.com/api/checkout/sessions and https://docs.stripe.com/checkout/fulfillment
