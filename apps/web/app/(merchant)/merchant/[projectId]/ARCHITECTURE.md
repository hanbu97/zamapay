# Project Route Architecture

## Tree

```text
apps/web/app/(merchant)/merchant/[projectId]
`-- page.tsx # Project-scoped control plane route with one public read-only demo-project exception
```

## Decisions

- `/merchant/[projectId]` is the project boundary; it never owns account subscription upgrades or all-project totals.
- The route loads one Rust project overview plus the account billing snapshot for the authenticated owner, then delegates browser-owned mutations to `PaymentProjectConsole`.
- The hardcoded demo project id may render without a session, but only with read-only console props and no billing write context.
- Project subsection navigation lives in `AppSidebar`; the overview owns settlement actions and balance activity instead of creating a separate withdraw page.
- Missing projects return `notFound`; missing sessions redirect to `/login` with the project URL preserved.
