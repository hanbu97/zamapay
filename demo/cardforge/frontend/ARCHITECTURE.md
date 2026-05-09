# CardForge Frontend Architecture

## Tree

```text
frontend
|-- app/              # Next.js shell, page, icon, and local CSS tokens
|-- components/
|   |-- cardforge/ConfidentialWalletPanel.tsx # Buyer wallet connect plus app-rendered confidential cUSDT balance
|   |-- cardforge/CreateCheckoutButton.tsx    # Checkout creation and fulfillment refresh clients
|   `-- ui/                              # shadcn primitives
|-- lib/              # Browser-safe config plus CardForge backend client
|-- components.json   # shadcn registry contract
|-- package.json      # Standalone frontend package
|-- package-lock.json # Frontend dependency lockfile owned by the template
`-- tsconfig.json     # TypeScript boundary
```

## Decisions

- The frontend is a template storefront, not a payment platform client.
- It is a standalone Next.js package; it does not join the root npm workspace.
- `lib/config.ts` exposes only the CardForge backend URL and Mermer Pay console link.
- `lib/cardforge-api.ts` calls the CardForge backend checkout, fulfillment, and confidential wallet endpoints without browser credentials, so Mermer Pay session cookies never enter the demo backend.
- `ConfidentialWalletPanel.tsx` opens MetaMask only for account connection and Hardhat chain selection; it renders local cUSDT from the confidential balance projection returned by CardForge, not from a public ERC20 token list.
- Checkout redirects use the backend response; invoice construction, billing quote validation, fulfillment release, and Mermer Pay API calls stay server-side.
- The storefront shows demo card secrets only after the backend confirms a signed `invoice.fulfillment_ready` callback.
