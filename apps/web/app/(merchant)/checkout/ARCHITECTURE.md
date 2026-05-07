# Checkout Route Architecture

## Tree

```text
apps/web/app/(merchant)/checkout
|-- [invoiceId]/page.tsx # Hosted buyer checkout with payment, finality, and webhook state
`-- ARCHITECTURE.md     # This map
```

## Decisions

- Checkout remains the hosted buyer surface issued by a merchant payment project; it reads invoice and contract manifest from Rust before rendering payment controls.
- The page shows payment truth, finality depth, release-gate state, and webhook status; merchant-template fulfillment artifacts stay outside the platform checkout.
