# Merchant Components Architecture

## Tree

```text
apps/web/components/merchant
|-- MerchantBillingOverview.tsx    # Account subscription status and previous billing payments
|-- MerchantBillingPanel.tsx       # Dedicated subscription pricing, comparison, and private payment client
|-- MerchantPortalUnavailable.tsx  # Protected project API unavailable fallback
|-- MerchantProjectsOverview.tsx   # Account-level project inventory and onboarding
|-- PaymentProjectConsole.tsx      # Project-scoped console for keys, webhooks, checkouts, and diagnostics
`-- PaymentProjectConsoleParts.tsx # Console-only leaf components, formatting, and setup-step projection
```

## Decisions

- Merchant components own platform configuration, not demo fulfillment logic.
- `MerchantProjectsOverview` is a client island for project inventory only: project creation, first API-key reveal, search, status filter, sort, and project entry.
- `MerchantBillingOverview` is read-only account billing: current plan, cycle, entitlement evidence, upgrade entry, and prior subscription payments.
- `MerchantBillingPanel` is the upgrade island: it renders plan selection, reads the chain pass, executes the browser-wallet Growth cUSDT approval/charge, finalizes the encrypted boolean, and then projects chain evidence.
- `PaymentProjectConsole` is a client island for one project: key issuance, webhook tests, delivery resend, project checkouts, and diagnostics.
- Console leaf components and formatting live in `PaymentProjectConsoleParts.tsx`; this removes duplicate status badge logic and keeps the main control plane small enough to read.
- Subscription controls new checkout fee entitlement; billing cards stay off the Projects page, while payment rows render Rust-projected gross, platform fee, and merchant net totals from contract-manifest terms without accepting client-selected rates.
- Project onboarding composes project creation, default API-key issuance, and webhook secret reveal into one blocking integration-bundle dialog; persisted UI uses prefixes and previews.
- The project Integration view starts with one `StatusStepper` that maps project, API key, webhook, delivery test, and checkout evidence into a compact setup flow.
- Later API-key rotation and extra webhook endpoints still use one-time dialogs scoped to the single secret being created.
