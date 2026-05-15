# Checkout Components Architecture

## Tree

```text
apps/web/components/checkout
|-- CheckoutPaymentCard.tsx         # Buyer wallet payment client: Zama private or ERC20 settlement rail
|-- checkout-helpers.ts             # Shared checkout status, wallet address, projection, and merchant-return helpers
`-- evm-funding.ts                  # ERC20 funding action descriptors, typed-data normalization, gas estimate buffering, and UI labels
```

## Decisions

- Checkout client code owns only browser-bound buyer actions: wallet chain switching, local encrypted input creation, ERC20 approve+settlement submission, and local status refresh.
- Rust remains the checkout read-model authority; the component pays the canonical gross amount and EVM asset from the public checkout read model before refreshing after chain finalization.
- Local Hardhat hosted checkout submits `PrivateCheckoutSettlement` directly from the buyer wallet. It debits `ConfidentialUSDMock`, decrypts only `accepted`, and never asks MetaMask to show or transfer cUSDT as a public ERC20 token.
- Ordinary EVM checkout uses the platform-created payment intent and ranked funding actions: exact token amount, settlement contract, settlement intent id, project id, fee split, network, expiry, and EIP-712 data come from Rust; the browser signs the selected action and prefers the same-origin relayer for gasless EIP-3009/Permit2 settlement submission.
- Relayer fallback is explicit: if the facilitator route is unavailable, the buyer can still submit the same settlement call from the wallet, and the checkout keeps polling indexer truth instead of trusting either client path.
- ERC20 settlement submits use provider gas estimation plus a small buffer, with method-specific bounded fallbacks for wallets that return pathological local estimates. The checkout must not hardcode one global gas limit across different funding methods.
- The checkout payment panel is the single centered buyer card; it renders only merchant identity, invoice reference, centered amount, current payment status, and one wallet confirmation action.
- ERC20 payment truth is still the settlement `EvmPaymentAccepted` event consumed by the indexer. Browser action choice, relayer-ready descriptors, and token transfers are evidence only.
- Payment verification/finalization is a platform-side local-dev bridge after the buyer transaction is mined, so private checkout never asks the buyer wallet to confirm a second finalization transaction.
- Successful checkout turns the card into a green success state and returns to the referring merchant storefront when the checkout was opened from one.
- Visual states are `Alert`, `Badge`, `Button`, `Card`, and `Spinner`, while payment state remains in local component state.
