# ZamaPay Architecture

## Tree

```text
.
|-- .env.example            # Local and Sepolia environment contract without secrets
|-- docker-compose.yml      # Local Postgres service for normalized portal state
|-- env/                    # Split process env contracts and ignored local secret files
|-- README.md               # Platform quickstart, verification commands, and testnet handoff
|-- apps/
|   `-- web/                 # Next.js ZamaPay platform shell
|-- contracts/              # Hardhat + Zama FHEVM contracts and deploy pipeline
|-- crates/
|   |-- api/                # Rust HTTP API, auth session, CORS, cookie boundary
|   |-- domain/             # Pure business rules for auth and invoice lifecycle
|   |-- storage/            # Process-local auth plus Postgres-backed portal read models
|   |-- indexer/            # Chain-event projection and finality semantics
|   |-- fulfillment/        # Digital-goods fulfillment worker boundary
|   `-- shared/             # Shared DTOs and typed ids, not chain schemas
|-- scripts/                # Root cross-package verification scripts
|-- docs/
|   `-- runbooks/           # Operator procedures and testnet handoff notes
|-- research/               # Product research that shapes pricing, positioning, and payment flows
|-- demo/
|   `-- */                  # Standalone merchant templates, outside root workspaces
|-- refs/                   # Read-only reference material
|-- zamapay-*.png            # Local visual QA evidence from Playwright and browser audits
`-- .omx/                   # Planning and workflow state
```

## Decisions

- `apps/web` owns ZamaPay platform UX and browser wallet orchestration only; it never becomes session authority.
- `demo/` is intentionally outside the root npm and Rust workspaces; templates must install and run from their own directories.
- `crates/api` owns wallet nonce issuance, signature verification, and cookie sessions.
- `crates/shared` holds API DTOs and typed ids only; ABI-derived schemas must stay in generated artifacts later.
- `docker-compose.yml` owns the local Postgres runtime; `DATABASE_URL` is the durable normalized portal-schema contract shared by local Docker and future hosted Postgres/Supabase.
- `env/` owns process-specific environment contracts; example files are commit-safe and same-name `.env` files are local secret material.
- Railway platform services use service-level build/start settings because `apps/web` and `crates/api` share the repository root differently; a single root `railway.toml` would lie about one of them.
- `crates/indexer` and `crates/fulfillment` exist from day one so Phase 2 can land without reshaping the tree.
- `contracts/` owns the Zama payment core: merchant registry, confidential token mock, invoice settlement, deploy, tests, and smoke scripts.
- `scripts/` owns root local-dev operations and cross-package verification; package-local behavior stays with the package that executes it.
- `research/` captures market and pricing evidence; it informs product decisions but is not runtime input.
- `generated/contracts/addresses` stores one manifest per environment so local and Sepolia deployments cannot overwrite each other.

## Current Scope

- The current implementation covers shadcn merchant console pages, wallet login, protected dashboard, hosted checkout, operator diagnostics, webhook/decrypt failure drills, Rust auth/session/read model, FHEVM contracts, local smoke, and Sepolia runbook.
- Remaining production hardening is normalized relational storage, automated indexer/worker runtime, and public-network deployment evidence.
