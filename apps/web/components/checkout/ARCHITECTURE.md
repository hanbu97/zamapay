# Checkout Components Architecture

## Tree

```text
apps/web/components/checkout
`-- CheckoutPaymentCard.tsx         # Buyer wallet payment client: local-dev encrypted settlement or Sepolia Zama settlement
```

## Decisions

- Checkout client code owns only browser-bound actions: wallet chain switching, encrypted approval, `payInvoice`, public payment-check decryption, `finalizePayment`, and backend projection after verified finalization.
- Rust remains the checkout read-model authority; the component pays the canonical gross amount from the read model before refreshing after chain finalization.
- Sepolia relayer payment is explicit. Local Hardhat hosted checkout uses dev-gated FHEVM mock input/decrypt bridges so the browser still signs encrypted `ConfidentialUSDMock.approve`, `ConfidentialInvoiceSettlement.payInvoice`, and `finalizePayment` transactions instead of a public ERC20 transfer.
- The checkout payment panel is the single centered buyer card; it renders only merchant identity, invoice reference, centered amount, current payment status, and one wallet action.
- Browser payment progress is one horizontal `StatusStepper` projection from the component's payment step, transaction hashes, and Rust read-model status; only the current stage exposes detail text.
- Visual states are `Alert`, `Badge`, `Button`, `Card`, `StatusStepper`, and `Spinner`, while payment state remains in local component state.
