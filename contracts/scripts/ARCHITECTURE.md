# Scripts Architecture

## Tree

```text
contracts/scripts
|-- deploy-contracts.js     # Deploy local-dev contracts and write manifest/billing/ERC20 terms
|-- deploy-local.js         # Compatibility wrapper for local deployment entry
|-- public-hardhat-keys.js  # Guard against known public local-test addresses
`-- sync-generated.js       # Copy ABI/address/billing manifest truth into generated/* clients
```

## Decisions

- `sync-generated.js` is the canonical bridge from Hardhat artifacts and address manifests into repo-level generated clients.
- `deploy-contracts.js` deploys `PrivateCheckoutSettlement`, `ConfidentialUSDMock`, subscription contracts, and local transparent USDT/USDC mocks; it does not deploy transparent invoice settlement or public-testnet manifests.
- `npm run node` plus `npm run deploy:localhost` is the persistent local-chain path; `deploy:local` remains the fast ephemeral path.
- Local cUSDT liquidity is wallet-owned: browsers call `ConfidentialUSDMock.claimTestTokens()` through MetaMask. There is no owner-mint script in the active MVP.
