# Contracts Architecture

## Scope

- `MerchantRegistry.sol` owns merchant identity and payout-wallet metadata for local product tests.
- `ConfidentialUSDMock.sol` is the local encrypted charge token used by `PrivateSubscriptionRegistry` Growth upgrades.
- `SubscriptionPass.sol` owns the soulbound merchant subscription NFT; it is identity, not transferable value.
- `PrivateSubscriptionRegistry.sol` owns encrypted subscription terms, local Growth self-serve checks, and pass issuance.
- `MockConfidentialPaymentRail.sol` owns the local-dev app-rendered cUSDT balance keyed by account commitment; it debits encrypted amounts for private checkout demos.
- `PrivateCheckoutSettlement.sol` owns Private Checkout v1: commitment-only checkout storage, encrypted expected/paid equality, relayer-only submission, replay/expiry guards, and public decrypt of only `accepted`.
- `scripts/sync-generated.js` and `scripts/deploy-contracts.js` are the bridge from Hardhat artifacts into generated clients and the single local-dev address manifest.

## Decisions

- Public-testnet deployment and the old transparent invoice settlement are not active paths. Public network support waits until Zama protocol-fee and relayer funding policy are explicit.
- Generated ABI/address clients expose only local-dev active contracts. `ConfidentialUSDMock` remains because subscription charging still uses it locally; checkout payment uses `MockConfidentialPaymentRail`.
- Hardhat keeps ephemeral local and persistent localhost lanes only.

## Verification

- `test/merchant-registry.js` locks the merchant registry write path.
- `test/private-checkout-settlement.js` locks the private checkout proof path, mock confidential rail debit, no buyer/merchant/payout/amount event exposure, rejected amount handling, replay prevention, expiry, and double-finalize rejection.
