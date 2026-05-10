# Environment Architecture

## Tree

```text
env
|-- README.md                              # How to compose service env files
|-- local-dev.zamapay-api.env.example      # Rust API server contract
|-- local-dev.zamapay-web.env.example      # ZamaPay Next.js app contract
|-- local-dev.cardforge-backend.env.example # CardForge merchant backend contract
|-- local-dev.cardforge-frontend.env.example # CardForge storefront browser contract
|-- sepolia.contracts.env.example       # Hardhat deployer contract for Sepolia
|-- sepolia.zamapay-api.env.example     # Rust API Sepolia contract selector
|-- sepolia.zamapay-web.env.example     # ZamaPay web Sepolia browser/server selector
|-- sepolia.cardforge-backend.env.example # CardForge Sepolia merchant backend contract
|-- sepolia.cardforge-frontend.env.example # CardForge Sepolia storefront browser contract
|-- supabase.zamapay-api.env.example       # Hosted Postgres override for ZamaPay API
`-- supabase.cardforge-backend.env.example # Hosted Postgres override for CardForge backend
```

## Decisions

- Service env files stay split by process because each process has a different trust boundary.
- `*.env.example` files are safe documentation; same-name `*.env` files hold local secrets and are ignored by git.
- Browser variables must use `NEXT_PUBLIC_*` and must not contain database URLs, project API keys, webhook secrets, or private keys.
- ZamaPay and CardForge use separate Postgres databases; sharing one database would blur platform truth and merchant-demo truth.
- Supabase files are database overrides only. Chain selection is controlled by `ZAMAPAY_CONTRACT_ENV` and `NEXT_PUBLIC_CONTRACT_ENV`.
- Sepolia files select deployed public-testnet contracts; the web server may hold the checkout-creator key for local demo invoice creation, while browser FHE proofs still come from Zama's official test relayer via SDK `SepoliaConfig`.
