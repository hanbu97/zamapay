# App Router Architecture

## Tree

```text
apps/web/app
|-- layout.tsx              # Root HTML/font shell only
|-- page.tsx                # Public Mermer Pay website home with session-aware login/console entry and footer navigation
|-- login/page.tsx          # Dedicated wallet sign-in page for missing or expired sessions
|-- pricing/page.tsx        # Public pricing strategy and fee schedule
|-- icon.svg                # Browser tab icon
|-- globals.css             # Tailwind v4 and shadcn tokens
|-- docs/                   # Public integration documentation system
|-- (merchant)/
|   |-- layout.tsx          # Merchant console sidebar/topbar shell
|   |-- merchant/page.tsx   # Protected payment project control plane
|   |-- dashboard/page.tsx  # Protected payments workspace
|   |-- ops/page.tsx        # Protected operator diagnostics console
|   `-- checkout/[invoiceId]/page.tsx
`-- api/                    # Server-only bridge routes; no product chrome
```

## Decisions

- `/` is the public website home; it reads session state only to decide whether CTA and footer workspace links point to login or console.
- `/login` is standalone so expired or anonymous sessions get a focused wallet sign-in page rather than merchant console chrome.
- `/pricing` publishes the adopted hybrid pricing model from `research/pricing.md`: free monthly access at a 0.50% successful-checkout take rate, paid checkout fee reductions, workload-specific fees, and Zama confidential checkout as premium value.
- `components/marketing` owns public quick navigation, Zama references, and placeholder social entrances so public routes share one compact navbar/footer contract.
- `/docs` is the public developer documentation system for quickstart, API, webhooks, CardForge, and environment proof.
- `(merchant)` owns the app shell so dashboard, checkout, login, ops, and project pages share one persistent top bar.
- `/merchant`, `/dashboard`, and `/ops` are merchant/operator console surfaces and redirect anonymous visitors to `/login`.
- API routes stay outside `(merchant)` because HTTP bridges must not depend on product layout concerns.
