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
|-- generated/        # Deployable contract and runtime-profile snapshots copied from root truth
|-- lib/              # Browser-safe rail config, CardForge backend client, and active-chain wallet reader
|-- components.json   # shadcn registry contract
|-- next.config.ts    # Next headers needed by the Zama browser relayer and Railway production serving
|-- package.json      # Standalone frontend package and Railway-friendly start script
|-- package-lock.json # Frontend dependency lockfile owned by the template
`-- tsconfig.json     # TypeScript boundary
```

## Decisions

- The frontend is a template storefront, not a payment platform client.
- It is a standalone Next.js package; it does not join the root npm workspace.
- Production responses include COOP/COEP headers so the Zama browser relayer can use threaded WASM primitives outside local dev.
- `lib/config.ts` exposes only browser-safe deployment shape: CardForge backend URL, ZamaPay console link, visible payment rail label, and display asset symbol.
- `lib/cardforge-api.ts` calls only the CardForge backend checkout, fulfillment, and webhook-log endpoints without browser credentials, so ZamaPay session cookies never enter the demo backend.
- `generated/contracts.ts` and `generated/runtime-profiles.json` are copied into the frontend package so Railway path-root deploys do not depend on files outside the service archive.
- `lib/confidential-wallet.ts` selects the active contract environment from `NEXT_PUBLIC_RUNTIME_PROFILE`, reads the package-local generated address manifest, and keeps local-dev and Sepolia behind one browser wallet API.
- `app/page.tsx` owns the selected wallet address so the catalog can tag checkout intent with the buyer wallet while the wallet panel can render wallet-scoped records.
- `ConfidentialWalletPanel.tsx` opens MetaMask for account connection, active-chain selection, and private `claimTestTokens()` faucet transactions; EVM rail mode relabels checkout activity but does not expose server secrets or merchant config to the browser.
- Local-dev balance reveal uses the Hardhat FHEVM mock RPC. Sepolia balance reveal uses Zama's browser relayer SDK and wallet-signed user decrypt permission.
- The wallet panel splits buyer feedback into two internally scrolling surfaces: unlocked cards from the CardForge backend and chain transaction history from browser-local mint hashes plus wallet-scoped checkout payment records.
- Wallet transaction history keeps mint hashes keyed by wallet plus token address; checkout payment hashes come from `/api/wallets/{wallet}/activity`.
- `ProductCoverflow.tsx` shows the active payment rail, warms product-scoped private checkout invoices only through the backend, then sends selected product id and optional connected buyer wallet only to the merchant backend. It never sends merchant wallet, payout wallet, raw order id, or client-chosen amount.
- Checkout redirects use the backend response; invoice construction, billing quote validation, fulfillment release, and ZamaPay API calls stay server-side.
- The storefront shows demo card secrets only after the backend confirms a signed `invoice.fulfillment_ready` callback.
