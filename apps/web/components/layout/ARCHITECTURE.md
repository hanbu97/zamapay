# Layout Components Architecture

## Tree

```text
apps/web/components/layout
|-- AppSidebar.tsx # Session-aware account/project shadcn Sidebar navigation with home brand link
|-- PageHeader.tsx # Compact page title, description, badge, and action area
`-- TopBar.tsx     # Session-aware sticky top bar with breadcrumbs and account logout menu
```

## Decisions

- Layout owns navigation and product chrome; pages own only business content.
- Sidebar sections mirror ownership: account scope shows Projects, Overview, and Billing; project scope shows All projects, Integration, Webhooks, Payments, and Diagnostics for the selected project.
- The sidebar brand block is the only persistent return-to-home affordance; the top bar stays focused on current app location and account state.
- `AppSidebar` is client-side because active-route detection, sidebar state, and session-shaped navigation are browser concerns.
- Anonymous chrome exposes only login; dashboard, project console, and diagnostics links appear only after the server layout proves a merchant session.
- `TopBar` renders location with shadcn Breadcrumb components and keeps the plan badge plus wallet avatar as a compact account menu.
- Global operator diagnostics stay out of merchant chrome; project diagnostics remain inside the selected project where they have merchant context.
