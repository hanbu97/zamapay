# Ops Page Architecture

## Tree

```text
apps/web/app/(merchant)/ops
|-- page.tsx         # Server-side operator diagnostics console
`-- ARCHITECTURE.md # This map
```

## Decisions

- The page reads diagnostics through `lib/operator.ts`, so the operator key stays on the server.
- Queue, incident, and invoice surfaces use shadcn cards, tabs, badges, items, progress, alerts, and tables; no page-local widget system exists here.
- Webhook and decrypt guard states are displayed from backend snapshots; the page does not infer delivery, decrypt, or fulfillment truth from neighboring status fields.
- Sepolia refuses the local default operator key because public-network operations cannot inherit local credentials.
