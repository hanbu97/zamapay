# CardForge Frontend Architecture

## Tree

```text
frontend
|-- app/              # Next.js shell, page, icon, and local CSS tokens
|-- components/       # CardForge UI and shadcn primitives
|-- lib/              # Browser-safe config plus CardForge backend client
|-- components.json   # shadcn registry contract
|-- package.json      # Standalone frontend package
|-- package-lock.json # Frontend dependency lockfile owned by the template
`-- tsconfig.json     # TypeScript boundary
```

## Decisions

- The frontend is a template storefront, not a payment platform client.
- It is a standalone Next.js package; it does not join the root npm workspace.
- `lib/config.ts` exposes only the CardForge backend URL and Mermer Pay console link.
- `lib/cardforge-api.ts` calls the CardForge backend checkout endpoint without browser credentials, so Mermer Pay session cookies never enter the demo backend.
- Checkout redirects use the backend response; invoice construction and Mermer Pay API calls stay server-side.
