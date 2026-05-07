# Mermer Pay Merchant Payment Loop Consensus Plan

## Verdict

APPROVED by Planner, Architect, and Critic.

## Decision

Build a project-first merchant payment platform. A merchant creates a `PaymentProject`, generates project-scoped API keys and webhook settings, then an independent merchant template such as CardForge uses `MERMER_PAY_PROJECT_ID` plus `MERMER_PAY_API_KEY` to create hosted checkout sessions.

Phase-one chain invoice authority is a platform-hosted project merchant signer. API keys authenticate the project; they never become chain signers. Mermer Pay creates the chain invoice through the project environment signer before returning a buyer-payable hosted checkout URL.

## Decision Drivers

1. CardForge and future merchants must create hosted checkouts without forwarding a browser merchant cookie.
2. A hosted checkout must be payable only after `chain_invoice_id` exists.
3. Webhooks must be project-scoped signed outbox records, not a global env callback.

## Alternatives

| Option | Decision | Reason |
| --- | --- | --- |
| Platform-hosted project merchant signer | Chosen for phase one | It fits the current contract where `createInvoice` requires a registered `msg.sender`, and it closes the API checkout loop quickly. |
| Merchant delegation or meta transaction | Later | Better long-term custody model, but requires contract/API/signature changes beyond this milestone. |
| Keep `/api/invoices` plus cookie forwarding | Rejected | It keeps CardForge coupled to Mermer Pay browser auth and can create non-payable checkout pages. |

## Architecture Guardrails

- `POST /api/projects/{projectId}/checkout-sessions` is the only external merchant checkout creation endpoint.
- Checkout sessions may not enter `open` or return a buyer-payable checkout URL until chain invoice creation succeeds.
- `ProjectInvoiceAuthority` stores signer address, key reference, mode, environment, and registration health; it never stores private keys.
- `InvoiceRecord` remains settlement/read-model projection only.
- `WebhookEventRecord` is immutable.
- `WebhookDeliveryRecord` stores endpoint delivery attempts, signature headers, HTTP status/body/error, retry time, and dead-letter state.
- CardForge must delete cookie forwarding and use project id plus bearer API key.
- Local-dev and Sepolia are separate project environments with explicit UI labels and separate verification.

## Domain Model

- `PaymentProject`: owner wallet, name, default environment.
- `PaymentProjectEnvironment`: chain id, contracts, environment, invoice authority, active/disabled status.
- `ProjectInvoiceAuthority`: `platform-hosted-signer`, signer address, key ref, merchant registration state.
- `ProjectApiKey`: project, environment, prefix, secret hash, last use, revoked state; secret revealed once.
- `WebhookEndpointRecord`: project, environment, URL, enabled state, secret ref/hash.
- `CheckoutSession`: merchant-facing order, idempotency key, amount, URLs, status, chain invoice id.
- `InvoiceRecord`: settlement projection for checkout session and chain invoice.
- `WebhookEventRecord`: immutable event payload.
- `WebhookDeliveryRecord`: delivery attempt/readiness state.

## Endpoint Plan

Console cookie-auth:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/{projectId}`
- `GET /api/projects/{projectId}/environments`
- `POST /api/projects/{projectId}/api-keys`
- `POST /api/projects/{projectId}/api-keys/{keyId}/rotate`
- `POST /api/projects/{projectId}/api-keys/{keyId}/revoke`
- `GET /api/projects/{projectId}/webhook-endpoints`
- `POST /api/projects/{projectId}/webhook-endpoints`
- `PATCH /api/projects/{projectId}/webhook-endpoints/{endpointId}`
- `POST /api/projects/{projectId}/webhook-endpoints/{endpointId}/test`
- `GET /api/projects/{projectId}/checkout-sessions`
- `GET /api/projects/{projectId}/events`
- `GET /api/projects/{projectId}/deliveries`
- `POST /api/projects/{projectId}/deliveries/{deliveryId}/resend`

Merchant API-key auth:

- `POST /api/projects/{projectId}/checkout-sessions`
- `GET /api/projects/{projectId}/checkout-sessions/{sessionId}`

Hosted checkout:

- `GET /checkout/{checkoutSessionId}`

Outbox dispatcher:

- claim due deliveries, sign payload, POST webhook, persist success/retry/dead-letter result.

## UI Plan

- `/merchant`: project list, create project CTA, selected project health, environment selector.
- `/merchant/projects/[projectId]`: Overview, Integration, Webhook, Payments, Diagnostics tabs.
- Integration tab: project id, API base URL, checkout base URL, API key one-time reveal/rotation.
- Webhook tab: endpoint URL, secret preview, test webhook, delivery log.
- Payments tab: checkout sessions and settlement state filtered by project.
- Diagnostics tab: retries, dead letters, manual resend.
- `/dashboard`: settlement-focused stats and recent payments, scoped to the selected project.
- `/checkout/{checkoutSessionId}`: payment disabled if `chain_invoice_id` is missing.

## Phases

1. Domain backbone: DTOs, storage, persistence, idempotency indexes, architecture docs.
2. Chain invoice authority: hosted signer model, local deterministic signer seed, Sepolia signer health check.
3. API and console UI: project/key/webhook/checkout-session endpoints and pages.
4. Deterministic local loop: project -> key -> CardForge checkout -> payment projection -> signed webhook -> dashboard stats.
5. Webhook dispatcher diagnostics: retry, dead-letter, manual resend, test webhook.
6. CardForge integration: bearer API key, project id, signed webhook verification, no cookie forwarding.
7. Sepolia browser proof: real checkout payment, finality projection, webhook delivery, dashboard and CardForge state.

## Verification Gates

- Storage tests prove project/session/event/delivery invariants.
- API tests prove key creation/revoke/rotate, cross-project rejection, idempotent checkout creation, and missing signer lock.
- Checkout session creation returns non-null `chain_invoice_id` before returning a buyer-payable URL.
- Hosted checkout refuses payment when `chain_invoice_id` is null.
- Webhook tests prove signature, retry, dead-letter, resend, and idempotent event handling.
- CardForge tests prove bearer API key usage and no cookie forwarding.
- Local e2e proves deterministic closed loop.
- Sepolia manual proof captures browser wallet tx, projection, webhook delivery, dashboard stats, and CardForge order update.

## Execution Guidance

For `$ralph`, run sequentially through phases 1-7 with `executor` and a verifier pass after every phase.

For `$team`, split lanes:

- Rust domain/API lane: `executor`, high reasoning.
- Web console/checkout lane: `executor` or `designer`, high reasoning.
- CardForge lane: `executor`, medium/high reasoning.
- Verification lane: `test-engineer` then `verifier`, medium/high reasoning.

Suggested launch:

- `$ralph implement .omx/plans/merchant-payment-project-loop-consensus-plan.md`
- `$team implement .omx/plans/merchant-payment-project-loop-consensus-plan.md with Rust API, web UI, CardForge, and verification lanes`

## Sources

- Infini hosted checkout: https://developer.infini.money/docs/en/3-checkout-mode
- Infini webhook: https://developer.infini.money/docs/en/7-webhook
- Cryptomus invoice creation: https://doc.cryptomus.com/merchant-api/payments/creating-invoice
- Coinbase webhook creation: https://docs.cdp.coinbase.com/api-reference/payment-acceptance/webhooks/create-webhook
- Stripe Checkout fulfillment: https://docs.stripe.com/checkout/fulfillment
