# Docs Slug Route Architecture

## Tree

```text
apps/web/app/docs/[slug]
|-- page.tsx          # Static article page resolved from docs-content by slug
`-- ARCHITECTURE.md   # Route note
```

## Decisions

- Slugs are generated from `docs-content.ts`, keeping route availability and sidebar navigation in one source of truth.
- Unknown slugs return `notFound()` instead of rendering a partial shell.
