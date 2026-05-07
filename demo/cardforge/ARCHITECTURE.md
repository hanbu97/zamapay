# CardForge Demo Architecture

## Tree

```text
demo/cardforge
|-- backend/          # Rust merchant backend for Mermer Pay checkout and webhook integration
|-- frontend/         # Next.js CardForge template storefront
|-- README.md         # Standalone runbook and boundary contract
`-- ARCHITECTURE.md  # Boundary contract for this standalone demo project
```

## Decisions

- CardForge is not part of the Mermer Pay platform. It is a separate merchant template demo and is not a member of the root npm or Rust workspaces.
- The frontend owns catalog display, demo navigation, and buyer intent. It calls only `NEXT_PUBLIC_CARDFORGE_API_URL`.
- The backend owns Mermer Pay API URL, project id, API key, hosted checkout creation, webhook signature verification, webhook receipt, and release policy.
- Mermer Pay remains the platform of record for merchant login, invoice truth, hosted checkout, payment state, finality, and settlement.
- The dependency direction is one-way: `frontend -> backend -> Mermer Pay`. No Mermer Pay component, route, or server config is imported into the frontend.

## Change Log

- Removed root workspace coupling; the template now installs and runs from its own frontend and backend directories.
- Split the former single Next app into independent frontend and backend projects.
- Moved browser-safe config to `frontend/.env.example`.
- Moved payment-provider config and webhook endpoint to `backend/.env.example`.
- Switched checkout creation from merchant-session forwarding to project API-key auth.
