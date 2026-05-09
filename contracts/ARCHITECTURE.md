# Contracts Architecture

## Scope

- `MerchantRegistry.sol` owns merchant identity and payout-wallet metadata for local product tests.
- `ConfidentialUSDMock.sol` is the local official-style mintable cUSDT mock used by Growth upgrades, CardForge buyer faucet claims, and private checkout debits.
- `SubscriptionPass.sol` owns the soulbound merchant subscription NFT; it is identity, not transferable value.
- `PrivateSubscriptionRegistry.sol` owns encrypted subscription terms, local Growth self-serve checks, and pass issuance.
- `PrivateCheckoutSettlement.sol` owns Private Checkout v1: commitment-only checkout storage, encrypted expected/paid equality, direct buyer submission, replay/expiry guards, and public decrypt of only `accepted`.
- `scripts/sync-generated.js` and `scripts/deploy-contracts.js` are the bridge from Hardhat artifacts into generated clients and the single local-dev address manifest.

## Decisions

- Public-testnet deployment and the old transparent invoice settlement are not active paths. Future Sepolia support should use Zama official relayer/gateway surfaces for FHE operations instead of a Mermer Pay platform relayer.
- Generated ABI/address clients expose only local-dev active contracts. `ConfidentialUSDMock` is the single cUSDT mock for subscription charging, faucet claims, and checkout payment.
- Hardhat keeps ephemeral local and persistent localhost lanes only.

## Verification

- `test/merchant-registry.js` locks the merchant registry write path.
- `test/private-checkout-settlement.js` locks the private checkout proof path, mock cUSDT debit, no merchant/payout/order/amount event exposure, rejected amount handling, replay prevention, expiry, and double-finalize rejection.
- `test/private-subscription-registry.js` locks Growth subscription charging through `ConfidentialUSDMock.approve` plus `PrivateSubscriptionRegistry.requestSubscriptionChange`.
