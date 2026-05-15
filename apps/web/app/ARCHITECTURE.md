# App Router Architecture

## Tree

```text
apps/web/app
|-- layout.tsx              # Root HTML/font shell only
|-- page.tsx                # Public ZamaPay website home with session-aware login/console entry and footer navigation
|-- llms.txt/route.ts       # Compact AI-readable docs index generated from public Markdoc content
|-- llms-full.txt/route.ts  # Full AI-readable docs corpus generated from public Markdoc content
|-- login/page.tsx          # Dedicated wallet sign-in page for missing or expired sessions
|-- pricing/page.tsx        # Public pricing strategy and fee schedule
|-- checkout/[invoiceId]/page.tsx # Standalone buyer hosted checkout
|-- icon.svg                # Browser tab icon
|-- globals.css             # Tailwind v4 and shadcn tokens
|-- docs/                   # Public integration documentation system
|-- .well-known/            # Agent-readable skill discovery routes
|-- (merchant)/
|   |-- layout.tsx          # Merchant console sidebar/topbar shell with session and subscription chrome
|   |-- billing/page.tsx    # Protected account subscription status and payment history
|   |-- billing/upgrade/page.tsx # Protected account subscription upgrade flow
|   |-- merchant/page.tsx   # Protected account-level project inventory and creation
|   |-- merchant/[projectId]/page.tsx # Protected project settings plus the public read-only demo dashboard exception
|   `-- dashboard/page.tsx  # Protected all-project payment overview
`-- api/                    # Server-only bridge routes; no product chrome
```

## Decisions

- `/` is the public website home; it reads session state only to decide whether CTA and footer workspace links point to login or console.
- `/login` is standalone so expired or anonymous sessions get a focused wallet sign-in page rather than merchant console chrome.
- `/pricing` publishes the adopted hybrid pricing model from `research/pricing.md`; plan fees and prices are rendered from the generated contract manifest so Solidity remains the fee source of truth.
- `/llms.txt` and `/llms-full.txt` expose the public docs in AI-readable form without creating a second documentation source.
- `/.well-known/skills/zamapay` publishes the committed ZamaPay Skill so coding agents inherit the same integration guardrails as the docs.
- `components/marketing` owns public quick navigation, Zama references, and placeholder social entrances so public routes share one compact navbar/footer contract.
- `/docs` is the public developer documentation system for quickstart, API, webhooks, CardForge, and environment proof.
- `/checkout/[invoiceId]` is a standalone buyer surface with its own centered payment card and no merchant console chrome.
- `(merchant)` owns the app shell so dashboard, account projects, and project-detail pages share one persistent top bar fed by session and billing subscription truth.
- `/merchant` is account scope for project inventory and creation; it deliberately omits billing and aggregate analytics.
- `/billing` is account scope for subscription entitlement and prior subscription payments; `/billing/upgrade` owns billing cycle selection, private upgrade proof, and tier comparison.
- `/merchant/[projectId]` is project scope: project keys, webhooks, checkout sessions, and settlement activity.
- `/merchant`, `/dashboard`, and `/billing` are merchant console surfaces and redirect anonymous visitors to `/login`; `/merchant/[projectId]` does the same except for the hardcoded public demo project, which renders read-only.
- API routes stay outside `(merchant)` because HTTP bridges must not depend on product layout concerns.
