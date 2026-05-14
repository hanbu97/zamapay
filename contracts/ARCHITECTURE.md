# Contracts Architecture

## Scope

- `MerchantRegistry.sol` owns merchant identity and payout-wallet metadata for local product tests.
- `ConfidentialUSDMock.sol` is the local official-style mintable cUSDT mock used by Growth upgrades, CardForge buyer faucet claims, and private checkout debits; approved debit operators can move encrypted exact amounts without a separate wallet approval transaction.
- `StandardERC20Mock.sol` is the local transparent ERC20 USDT/USDC mock used by the ordinary EVM rail; it emits canonical `Transfer(address,address,uint256)` logs for indexer tests.
- `SubscriptionPass.sol` owns the soulbound merchant subscription NFT; it is identity, not transferable value.
- `PrivateSubscriptionRegistry.sol` owns encrypted subscription terms, local Growth self-serve checks, and pass issuance.
- `PrivateCheckoutSettlement.sol` owns Private Checkout v1: commitment-only checkout storage, bucket-owner commitments, encrypted gross/net/fee split validation, encrypted buyer debit, merchant/platform pending buckets, replay/expiry guards, public decrypt of only payment/withdraw booleans, and EIP-712 merchant-authorized encrypted withdraw that a chain submitter can send.
- `hardhat.config.js` reads the shared runtime profile contract for local and Sepolia chain ids/RPC URLs.
- `scripts/sync-generated.js` and `scripts/deploy-contracts.js` are the bridge from Hardhat artifacts into generated clients, private-checkout addresses, and local standard ERC20 token manifests.

## Decisions

- Sepolia deployment is an active target. Browser FHE input/public-decrypt work must use Zama's official test relayer; ZamaPay must not reintroduce a product-owned relayer.
- Generated ABI/address clients expose the selected active manifest. `ConfidentialUSDMock` is the single cUSDT mock for subscription charging, faucet claims, checkout payment, and private withdraw settlement movement; standard ERC20 mocks are separate transparent assets for the non-private rail.
- Hardhat keeps ephemeral local and persistent localhost lanes only.

## Verification

- `test/merchant-registry.js` locks the merchant registry write path.
- `test/standard-erc20-mock.js` locks canonical transparent ERC20 faucet and `Transfer` log behavior for local rail indexing.
- `test/private-checkout-settlement.js` locks the private checkout proof path, mock cUSDT debit, encrypted merchant pending accrual, merchant-authorized withdraw, rejected amount handling, replay prevention, expiry, and double-finalize rejection.
- `test/private-subscription-registry.js` locks one-transaction Growth subscription charging through `PrivateSubscriptionRegistry.requestMerchantSubscriptionChange`.
