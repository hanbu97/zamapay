# CardForge Frontend Architecture

## Tree

```text
frontend
|-- app/              # Next.js shell, page, icon, and local CSS tokens
|-- components/
|   |-- cardforge/ConfidentialWalletPanel.tsx # Buyer wallet connect, confidential cUSDT balance, and local tx activity
|   |-- cardforge/CreateCheckoutButton.tsx    # Checkout creation and fulfillment refresh clients
|   |-- cardforge/ProductCoverflow.tsx        # Swiper Coverflow product cards for visible game-item tiers
|   `-- ui/                              # shadcn primitives
|-- lib/              # Browser-safe config, CardForge backend client, and local Hardhat wallet reader
|-- components.json   # shadcn registry contract
|-- package.json      # Standalone frontend package
|-- package-lock.json # Frontend dependency lockfile owned by the template
`-- tsconfig.json     # TypeScript boundary
```

## Decisions

- The frontend is a template storefront, not a payment platform client.
- It is a standalone Next.js package; it does not join the root npm workspace.
- `lib/config.ts` exposes only the CardForge backend URL and Mermer Pay console link.
- `lib/cardforge-api.ts` calls only the CardForge backend checkout and fulfillment endpoints without browser credentials, so Mermer Pay session cookies never enter the demo backend.
- `lib/local-confidential-wallet.ts` reads and claims `ConfidentialUSDMock` directly through Hardhat/FHEVM mock RPC; successful claims return the wallet tx hash and receipt metadata.
- `ConfidentialWalletPanel.tsx` opens MetaMask for account connection, Hardhat chain selection, and `claimTestTokens()` faucet transactions; it renders local cUSDT from `ConfidentialUSDMock`, not from a public ERC20 token list.
- Wallet transaction history is browser-local UI state keyed by wallet plus token address. It records confirmed local mint hashes, revalidates them against Hardhat receipts on refresh, and avoids backend balance projection.
- `ProductCoverflow.tsx` is presentation-only catalog UI; it shows game-item tiers and integer cUSDT prices without changing the backend-owned checkout amount.
- Checkout redirects use the backend response; invoice construction, billing quote validation, fulfillment release, and Mermer Pay API calls stay server-side.
- The storefront shows demo card secrets only after the backend confirms a signed `invoice.fulfillment_ready` callback.
