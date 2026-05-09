# Scripts Architecture

## Tree

```text
contracts/scripts
|-- deploy-contracts.js     # Deploy local-dev contracts and write manifest/billing terms
|-- deploy-local.js         # Compatibility wrapper for local deployment entry
|-- mint-test-usd.js        # Owner mint helper for local subscription charge liquidity
|-- public-hardhat-keys.js  # Guard against known public local-test addresses
`-- sync-generated.js       # Copy ABI/address/billing manifest truth into generated/* clients
```

## Decisions

- `sync-generated.js` is the canonical bridge from Hardhat artifacts and address manifests into repo-level generated clients.
- `deploy-contracts.js` deploys `PrivateCheckoutSettlement`, `MockConfidentialPaymentRail`, and the subscription contracts; it does not deploy transparent invoice settlement or public-testnet manifests.
- `npm run node` plus `npm run deploy:localhost` is the persistent local-chain path; `deploy:local` remains the fast ephemeral path.
- `mint-test-usd.js` remains only for local `ConfidentialUSDMock` subscription-charge liquidity. Checkout buyer balance is managed through `MockConfidentialPaymentRail` and the app-rendered confidential wallet panel.
