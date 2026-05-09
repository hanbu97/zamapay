# Scripts Architecture

## Tree

```text
contracts/scripts
|-- deploy-contracts.js             # Deploy current Hardhat network contracts, private checkout rail, and billing-term manifest
|-- deploy-local.js                 # Compatibility wrapper for local deployment entry
|-- mint-test-usd.js                # Owner mint helper for local/Sepolia buyer demo liquidity
|-- project-finalized-payment.js    # Parse InvoicePaid and private split handles, then project payment/finality into Rust
|-- public-hardhat-keys.js          # Shared guard against known public local-test addresses
|-- smoke-local-invoice.js          # Local chain + Rust API invoice creation, encrypted approval/payment, public decrypt, finalization, and fulfillment smoke
|-- sync-generated.js               # Copy ABI/address/billing manifest truth into generated/* clients
`-- verify-sepolia-readiness.js     # Sepolia RPC, deployer, buyer, secrets, web env, manifest, bytecode, and API readiness gate
```

## Decisions

- `sync-generated.js` is the canonical bridge from Hardhat artifacts and address manifests into repo-level generated clients.
- `sync-generated.js` preserves the current address manifest when only ABI/client regeneration is requested.
- `deploy-contracts.js` reads deployed subscription/settlement constants and writes billing terms plus `PrivateCheckoutSettlement` / `MockConfidentialPaymentRail` addresses through the same bridge, so web and Rust never need to duplicate contract fee policy.
- `npm run node` + `npm run deploy:localhost` is the persistent local-chain path; `deploy:local` remains the fast ephemeral path for CI-like validation.
- `deploy:sepolia` uses the same deployer and writes `generated/contracts/addresses/sepolia.json` when `DEPLOYER_PRIVATE_KEY` is configured.
- `mint-test-usd.js` is the legacy explicit buyer-liquidity step for transparent-token demos; local private checkout liquidity now comes from `MockConfidentialPaymentRail` through the app-rendered confidential wallet panel.
- `public-hardhat-keys.js` is a shared safety rail: deploy, mint, and readiness scripts reject known public Hardhat/Anvil-style test addresses on public networks before value-moving actions.
- `project-finalized-payment.js` is the manual operator bridge for demos without a persistent indexer: it parses an `InvoicePaid` transaction plus optional private split handles, posts payment projection, then advances confirmations.
- `smoke-local-invoice.js` proves wallet-owned invoice creation, confidential token mint/approval, exact encrypted buyer payment, private fee split handles, public payment-check decryption, settlement finalization, chain-id projection, confirmation advancement, and demo card-code release.
- `verify-sepolia-readiness.js` is the public-testnet gate: it refuses to call the demo ready unless RPC, deployer, non-default operator key, non-default webhook secret, non-default gateway callback key, browser environment, buyer address and gas balance, mint amount, generated manifest, on-chain bytecode, and Rust-served manifest agree.
