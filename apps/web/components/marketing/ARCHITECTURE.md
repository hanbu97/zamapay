# Marketing Components Architecture

## Tree

```text
apps/web/components/marketing
|-- PublicHeader.tsx       # Public site header with demo dashboard, CardForge demo, Docs menu, Pricing entry, and session-aware CTA
`-- PublicFooter.tsx       # Public site footer with product, docs, workspace, Zama, and social placeholder links
```

## Decisions

- Public navigation is centralized here so `/`, `/pricing`, docs chrome, and the public demo dashboard share one route contract.
- Components receive session state from the calling server page; they do not read cookies or own authentication.
- The Docs hover menu is the only expanded top-level navigation; Pricing stays a direct public route.
