# Checkout Components Architecture

## Tree

```text
apps/web/components/checkout
`-- CheckoutPaymentCard.tsx         # Buyer wallet payment client: local-dev encrypted payment
```

## Decisions

- Checkout client code owns only browser-bound actions: wallet chain switching, local encrypted input creation, direct buyer transaction submission, boolean finalization, and backend projection after verified finalization.
- Rust remains the checkout read-model authority; the component pays the canonical gross amount from the read model before refreshing after chain finalization.
- Local Hardhat hosted checkout submits `PrivateCheckoutSettlement` directly from the buyer wallet. It debits `ConfidentialUSDMock`, decrypts only `accepted`, and never asks MetaMask to show or transfer cUSDT as a public ERC20 token.
- The checkout payment panel is the single centered buyer card; it renders only merchant identity, invoice reference, centered amount, current payment status, and one wallet action.
- Browser payment progress is one horizontal `StatusStepper` projection from the component's payment step, transaction hashes, and Rust read-model status; only the current stage exposes detail text.
- Visual states are `Alert`, `Badge`, `Button`, `Card`, `StatusStepper`, and `Spinner`, while payment state remains in local component state.
