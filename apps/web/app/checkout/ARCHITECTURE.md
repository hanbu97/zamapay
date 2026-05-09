# Checkout Route Architecture

## Tree

```text
apps/web/app/checkout
|-- [invoiceId]/page.tsx # Standalone hosted buyer checkout, outside merchant console chrome
`-- ARCHITECTURE.md     # This map
```

## Decisions

- `/checkout/[invoiceId]` is a buyer payment surface, so it stays outside `(merchant)` and never inherits dashboard sidebar or account topbar chrome.
- The page owns only the standalone visual shell: modern full-viewport background, centered payment card, and invoice data loading from Rust plus the contract manifest.
- `CheckoutPaymentCard` owns wallet action, encrypted payment status, and the compact horizontal stage projection.
- Merchant webhook diagnostics and project operations remain in merchant dashboard routes, not on the buyer checkout.
