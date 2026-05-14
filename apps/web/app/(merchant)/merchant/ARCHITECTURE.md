# Merchant Route Architecture

## Tree

```text
apps/web/app/(merchant)/merchant
|-- page.tsx          # Account-level project inventory and project onboarding
|-- [projectId]/
|   |-- page.tsx      # Project-level keys, webhooks, payments, and settlement overview
|   `-- ARCHITECTURE.md
`-- ARCHITECTURE.md
```

## Decisions

- `/merchant` is account scope for project search, filter, sort, creation, and project entry only.
- Billing and all-project analytics stay outside this route so project inventory remains a simple management surface.
- `/merchant/[projectId]` is project scope: it owns one project's server secrets, webhook endpoints, checkout sessions, and settlement activity.
- Project creation issues the first project secret immediately and reveals the backend env export once; persisted views only keep prefixes and previews.
