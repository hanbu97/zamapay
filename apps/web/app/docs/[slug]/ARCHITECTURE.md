# Docs Slug Route Architecture

## Tree

```text
apps/web/app/docs/[slug]
|-- page.tsx          # Static article page resolved from Markdoc-backed docs-content metadata
`-- ARCHITECTURE.md   # Route note
```

## Decisions

- Slugs are generated from `docs/content/public/*.md` filenames through `docs-content.ts`, keeping route availability, page metadata, and sidebar navigation in one source.
- Unknown slugs return `notFound()` instead of rendering a partial shell.
- Metadata uses Markdoc frontmatter title and description so search/social text cannot drift from article content.
