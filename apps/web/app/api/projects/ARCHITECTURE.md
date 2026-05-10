# Projects API Route Architecture

## Tree

```text
apps/web/app/api/projects
`-- [[...path]]/route.ts # Proxies browser merchant-project session requests to Rust with the web-origin cookie
```

## Decisions

- Browser project calls must use the web origin because the session cookie is scoped to the Railway web host.
- The proxy preserves the Rust API as the single source of truth for projects, API keys, webhooks, withdrawals, and delivery retries.
- Server components can still call Rust directly with an explicit cookie header; browser calls use this route by passing a relative `/api/projects` URL.
