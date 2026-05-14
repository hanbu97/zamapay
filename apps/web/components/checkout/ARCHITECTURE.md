# Checkout Components Architecture

## Tree

```text
apps/web/components/checkout
`-- CheckoutPaymentCard.tsx         # Buyer wallet payment client: Zama private or ERC20 transfer rail
```

## Decisions

- Checkout client code owns only browser-bound buyer actions: wallet chain switching, local encrypted input creation, ERC20 transfer submission, and local status refresh.
- Rust remains the checkout read-model authority; the component pays the canonical gross amount and EVM asset from the public checkout read model before refreshing after chain finalization.
- Local Hardhat hosted checkout submits `PrivateCheckoutSettlement` directly from the buyer wallet. It debits `ConfidentialUSDMock`, decrypts only `accepted`, and never asks MetaMask to show or transfer cUSDT as a public ERC20 token.
- Ordinary EVM checkout uses the platform-created payment intent: exact token amount, leased receiver address, network, and expiry come from Rust, then the ERC20 indexer observes `Transfer` logs before payment truth changes; underpay, overpay, duplicate, expiry, and reorg states stay visible instead of silently paying.
- The checkout payment panel is the single centered buyer card; it renders only merchant identity, invoice reference, centered amount, current payment status, and one wallet confirmation action.
- Payment verification/finalization is a platform-side local-dev bridge after the buyer transaction is mined, so the hosted checkout never asks the buyer wallet to confirm a second transaction.
- Successful checkout turns the card into a green success state and returns to the referring merchant storefront when the checkout was opened from one.
- Visual states are `Alert`, `Badge`, `Button`, `Card`, and `Spinner`, while payment state remains in local component state.
