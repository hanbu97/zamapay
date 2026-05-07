# Layout Components Architecture

## Tree

```text
apps/web/components/layout
|-- AppSidebar.tsx # Session-aware shadcn Sidebar navigation and workspace switcher
|-- PageHeader.tsx # Compact page title, description, badge, and action area
`-- TopBar.tsx     # Session-aware sticky top bar with always-visible Home and breadcrumb
```

## Decisions

- Layout owns navigation and product chrome; pages own only business content.
- Sidebar sections contain Mermer Pay platform routes only; external merchant templates are not linked from platform chrome.
- `AppSidebar` is client-side because active-route detection, sidebar state, and session-shaped navigation are browser concerns.
- Anonymous chrome exposes only login; dashboard, project console, and diagnostics links appear only after the server layout proves a merchant session.
- `TopBar` keeps a Home control visible on every viewport so operators can return from merchant routes to the public website home without relying on the sidebar.
- Operator diagnostics is authenticated navigation chrome because failure queues must be reachable after login without hiding behind merchant invoice pages.
