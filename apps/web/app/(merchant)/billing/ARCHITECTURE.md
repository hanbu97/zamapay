# Billing Route Architecture

## Tree

```text
apps/web/app/(merchant)/billing
|-- page.tsx         # Account subscription status and payment history
|-- upgrade/
|   `-- page.tsx     # Dedicated account subscription upgrade flow
`-- ARCHITECTURE.md # This map
```

## Decisions

- `/billing` is account scope; it only renders current subscription truth, fee entitlement, and previous subscription payment records.
- `/billing/upgrade` is the only account route that changes subscription state through the private payment flow.
- Subscription upgrade actions stay in `MerchantBillingPanel`; `MerchantBillingOverview` remains a server-rendered read surface.
- Project settings do not live here; project-specific keys, webhooks, and payments remain under `/merchant/[projectId]`.
