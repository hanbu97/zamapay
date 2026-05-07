# Test Spec: Merchant Payment Project Loop

## Rust Unit

- API key generation returns secret once and persists only hash/prefix.
- API key verify rejects revoked and cross-project keys.
- Checkout session idempotency returns the same session for same project/environment/key.
- Checkout session cannot become `open` without `chain_invoice_id`.
- Chain invoice authority reports locked state for missing signer or unregistered merchant.
- Webhook event records are immutable.
- Delivery retry transitions pending -> retrying -> delivered/dead_letter.

## Rust Integration

- Cookie auth creates/list/updates project settings.
- API-key auth creates checkout session only for its project.
- Checkout creation calls chain invoice authority and stores chain invoice id.
- Chain invoice creation failure returns locked/conflict and no payable checkout URL.
- Finality-safe projection creates one webhook event and one delivery.
- Test webhook does not affect payment stats.
- Manual resend creates an auditable delivery attempt tied to the same event.

## Frontend

- `/merchant` renders project list and create project CTA.
- Project integration tab shows project id, API base URL, checkout base URL, and API key prefix.
- API key one-time reveal is copyable and disappears after navigation/reload.
- Webhook tab supports URL save, test webhook, delivery log, and failure state.
- Checkout page keeps payment disabled when `chainInvoiceId` is null.
- Dashboard stats are scoped to selected project.

## CardForge

- Backend fails fast without `MERMER_PAY_PROJECT_ID` or `MERMER_PAY_API_KEY`.
- Checkout creation sends bearer API key and idempotency key.
- Checkout creation never forwards browser cookie.
- Webhook receiver verifies Mermer signature.
- Duplicate webhook event id is idempotent.

## E2E

Local deterministic:

1. Login to Mermer Pay.
2. Create project.
3. Create API key.
4. Configure CardForge env from project config.
5. Start CardForge.
6. Create checkout from CardForge.
7. Open Mermer hosted checkout.
8. Complete deterministic local payment/projection.
9. Verify Mermer dashboard stats.
10. Verify CardForge webhook log and order release state.

Sepolia manual proof:

1. Use Sepolia project environment with registered hosted signer.
2. Create CardForge checkout.
3. Buyer pays through browser wallet/Zama relayer.
4. Capture finalization tx.
5. Verify Rust projection reaches paid and finality-safe.
6. Verify project webhook delivery returns 2xx.
7. Verify CardForge state updates from webhook, not redirect.
