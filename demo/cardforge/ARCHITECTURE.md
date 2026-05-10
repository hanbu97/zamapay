# CardForge Demo Architecture

## Tree

```text
demo/cardforge
|-- backend/          # Rust merchant backend for ZamaPay checkout and webhook integration
|-- frontend/         # Next.js CardForge template storefront
|-- README.md         # Standalone runbook and boundary contract
`-- ARCHITECTURE.md  # Boundary contract for this standalone demo project
```

## Decisions

- CardForge is not part of the ZamaPay platform. It is a separate merchant template demo and is not a member of the root npm or Rust workspaces.
- The frontend owns catalog display, demo navigation, buyer intent, and the currently connected wallet address. It calls only `NEXT_PUBLIC_CARDFORGE_API_URL`.
- The backend owns ZamaPay API URL, project id, API key, server-side catalog amounts, hosted checkout creation, private invoice creation, webhook signature verification, webhook receipt, release policy, and wallet-scoped owned-card persistence in its own Postgres database.
- ZamaPay remains the platform of record for merchant login, invoice truth, hosted checkout, payment state, finality, and settlement.
- The dependency direction is one-way: `frontend -> backend -> ZamaPay`. No ZamaPay component, route, or server config is imported into the frontend.

## Change Log

- Removed root workspace coupling; the template now installs and runs from its own frontend and backend directories.
- Split the former single Next app into independent frontend and backend projects.
- Moved browser-safe config to `frontend/.env.example`.
- Moved payment-provider config and webhook endpoint to `backend/.env.example`.
- Switched checkout creation from merchant-session forwarding to project API-key auth.
- Added wallet-scoped local persistence so a completed checkout visibly unlocks cards in the storefront sidebar.
- Moved CardForge-owned demo state from JSON/in-memory stores to an independent Postgres database for Supabase-style deployment.
