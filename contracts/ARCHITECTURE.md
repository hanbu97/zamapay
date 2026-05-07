# Contracts Architecture

## Scope

- `MerchantRegistry.sol` owns merchant identity and payout wallet truth.
- `ConfidentialUSDMock.sol` is the local confidential settlement token for test and demo flows; exact settlement transfers are conditional on encrypted allowance, balance, and amount checks.
- `ConfidentialInvoiceSettlement.sol` owns invoice creation, payment truth, encrypted settled amount handles, and two-step payment finalization; merchant decrypt jobs stay off-chain in relayer-backed app flows.
- ABI and address exports generated from this directory will become the only contract truth consumed by web and Rust.
- `scripts/sync-generated.js` and `scripts/deploy-contracts.js` are the bridge from artifact output into repo-level generated clients and address manifests.
- `scripts/project-finalized-payment.js` is the operator bridge from finalized chain payment into Rust projection for demos before a persistent indexer exists.
- `scripts/verify-sepolia-readiness.js` is the testnet readiness gate for RPC, deployer funds, manifest, bytecode, and Rust API agreement.
- Hardhat now exposes ephemeral local, persistent localhost, and Sepolia deploy lanes so Phase 2 can target a stable local chain before testnet.
- Hardhat loads the repo-root `.env` with a dependency-free parser before network resolution, and only treats `DEPLOYER_PRIVATE_KEY` as a signer when it is a real 32-byte hex key; placeholders stay out of network config so readiness can report missing or malformed inputs cleanly.

## Verification

- `test/merchant-registry.js` locks the merchant registry write path.
- `test/confidential-invoice-settlement.js` locks invoice lifecycle, exact encrypted token settlement, rejected underpayment retry, public payment-check finalization, and ACL-scoped merchant decrypt behavior.
