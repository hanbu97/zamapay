# PRD: Merchant Payment Project Loop

## Goal

Mermer Pay must support a real merchant integration loop: create a payment project, generate configuration, let CardForge create a hosted checkout via API key, collect payment, deliver a signed webhook, and show correct project dashboard state.

## Users

- Merchant operator: configures project, API key, webhook endpoint, and monitors payments.
- Merchant backend developer: consumes project id/API key/webhook secret.
- Buyer: pays on hosted checkout.
- Operator: diagnoses finality and webhook delivery failures.

## Scope

In scope:

- Project CRUD and project environment.
- API key create/rotate/revoke with one-time reveal.
- Hosted checkout sessions created by project API key.
- Platform-hosted project merchant signer for chain invoice creation.
- Project webhook endpoint, event outbox, delivery records, retry/dead-letter, test/resend.
- Project-scoped dashboard and integration UI.
- CardForge standalone integration using API key, not cookies.
- Local deterministic e2e and Sepolia browser proof.

Out of scope:

- Refunds.
- Subscriptions.
- Withdrawals/payouts.
- Multi-endpoint fanout beyond one active endpoint per environment.
- Production KMS integration beyond key-ref shaped model.
- Merchant delegation/meta-tx implementation.

## Acceptance Criteria

- A merchant can create a project after login.
- A merchant can create an API key and see the secret only once.
- A merchant can configure a webhook endpoint and send a test webhook.
- CardForge can create a hosted checkout with bearer API key and project id.
- Checkout session creation creates a chain invoice before returning a buyer-payable URL.
- Buyer checkout payment can be completed in local deterministic flow and later Sepolia browser flow.
- Finality-safe projection creates immutable webhook event and delivery record.
- CardForge receives signed webhook and updates local order/release state.
- Dashboard paid/pending/finality/webhook stats match backend records.

## Non-Negotiable Invariants

- No external merchant integration may depend on `mermer_session`.
- No private project signer key may be persisted in the project store.
- No checkout page may show an enabled payment action without `chain_invoice_id`.
- No merchant API may directly mark invoices as paid or finality-safe.
- No webhook delivery may be represented only as an invoice snapshot.
