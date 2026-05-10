# Environment Architecture

## Tree

```text
env
|-- README.md                              # How to compose service env files
|-- local-dev.zamapay-api.env.example      # Rust API server contract
|-- local-dev.zamapay-web.env.example      # ZamaPay Next.js app contract
|-- local-dev.cardforge-backend.env.example # CardForge merchant backend contract
|-- local-dev.cardforge-frontend.env.example # CardForge storefront browser contract
|-- supabase.zamapay-api.env.example       # Hosted Postgres override for ZamaPay API
`-- supabase.cardforge-backend.env.example # Hosted Postgres override for CardForge backend
```

## Decisions

- Service env files stay split by process because each process has a different trust boundary.
- `*.env.example` files are safe documentation; same-name `*.env` files hold local secrets and are ignored by git.
- Browser variables must use `NEXT_PUBLIC_*` and must not contain database URLs, project API keys, webhook secrets, or private keys.
- ZamaPay and CardForge use separate Postgres databases; sharing one database would blur platform truth and merchant-demo truth.
- Supabase files are overrides for hosted Postgres only. The local-dev chain remains Hardhat/FHEVM mock until the Sepolia contract path is implemented.
