# Checkout Components Architecture

## Tree

```text
apps/web/components/checkout
`-- CheckoutPaymentCard.tsx         # Buyer wallet + Zama relayer approval, payment, public decrypt, and finalize client
```

## Decisions

- Checkout client code owns only browser-bound actions: wallet chain switching, FHE input encryption, token approval, `payInvoice`, public payment-check decryption, and `finalizePayment`.
- Rust remains the checkout read-model authority; the component pays the canonical invoice amount from the read model and refreshes after chain finalization.
- Sepolia relayer payment is explicit. Local Hardhat encrypted payment stays in the deterministic smoke script until a browser mock relayer exists.
- The checkout payment panel is a shadcn `Card` composition; visual states are `Progress`, `Table`, `Alert`, `Badge`, `Button`, `StatusBadge`, and `Spinner`, while payment state remains in local component state.
