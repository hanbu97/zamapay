# Project Route Architecture

## Tree

```text
apps/web/app/(merchant)/merchant/[projectId]
`-- page.tsx # Project-scoped control plane route for keys, webhooks, payments, and diagnostics
```

## Decisions

- `/merchant/[projectId]` is the project boundary; it never owns account subscription upgrades or all-project totals.
- The route loads one Rust project overview plus the account billing snapshot, then delegates browser-owned mutations to `PaymentProjectConsole`.
- Project subsection navigation lives in `AppSidebar`; the route renders content for the selected section instead of creating another tab rail.
- Missing projects return `notFound`; missing sessions redirect to `/login` with the project URL preserved.
