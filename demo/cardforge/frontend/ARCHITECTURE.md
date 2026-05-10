# CardForge Frontend Architecture

## Tree

```text
frontend
|-- app/              # Next.js client shell, page, icon, and local CSS tokens
|-- components/
|   |-- cardforge/ConfidentialWalletPanel.tsx # Buyer wallet connect, private balance, owned cards, and tx history
|   |-- cardforge/CreateCheckoutButton.tsx    # Checkout creation and fulfillment refresh clients
|   |-- cardforge/ProductCoverflow.tsx        # Swiper Coverflow catalog and buyer checkout intent
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
- `lib/config.ts` exposes only the CardForge backend URL and ZamaPay console link.
- `lib/cardforge-api.ts` calls only the CardForge backend checkout, fulfillment, and webhook-log endpoints without browser credentials, so ZamaPay session cookies never enter the demo backend.
- `lib/local-confidential-wallet.ts` reads and claims `ConfidentialUSDMock` directly through Hardhat/FHEVM mock RPC; successful claims return the wallet tx hash and receipt metadata.
- `app/page.tsx` owns the selected wallet address so the catalog can tag checkout intent with the buyer wallet while the wallet panel can render wallet-scoped records.
- `ConfidentialWalletPanel.tsx` opens MetaMask for account connection, Hardhat chain selection, and `claimTestTokens()` faucet transactions; it renders local cUSDT from `ConfidentialUSDMock`, not from a public ERC20 token list.
- The wallet panel splits buyer feedback into two internally scrolling surfaces: unlocked cards from the CardForge backend and chain transaction history from browser-local mint hashes plus wallet-scoped checkout payment records.
- Wallet transaction history keeps mint hashes keyed by wallet plus token address; checkout payment hashes come from `/api/wallets/{wallet}/activity`.
- `ProductCoverflow.tsx` sends selected product id and optional connected buyer wallet only to the merchant backend. It never sends merchant wallet, payout wallet, raw order id, or client-chosen amount.
- Checkout redirects use the backend response; invoice construction, billing quote validation, fulfillment release, and ZamaPay API calls stay server-side.
- The storefront shows demo card secrets only after the backend confirms a signed `invoice.fulfillment_ready` callback.
