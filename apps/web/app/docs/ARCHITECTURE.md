# Docs Route Architecture

## Tree

```text
apps/web/app/docs
|-- layout.tsx       # Public docs shell with fixed-height top navigation and navbar-aware content viewport
|-- page.tsx         # Docs index with first-viewport guide map and primary article entries
|-- DocsArticle.tsx  # Server-rendered article renderer, guide figures, tables, and code blocks
|-- docs-content.ts  # Static documentation truth for quickstart, API, webhooks, CardForge, and environments
`-- [slug]/
    |-- page.tsx         # Static docs article route selected by slug
    `-- ARCHITECTURE.md  # Dynamic article route note
```

## Decisions

- Documentation is public because integration guidance must be readable before wallet login.
- The docs content is static TypeScript data, not MDX, so build output stays dependency-free and type checked.
- `/docs` opens directly into the documentation map; it is not a landing page stacked above a second docs layout.
- The docs body uses `100dvh - 3.5rem` as its minimum viewport so the sticky top navigation is not counted twice.
- `/merchant` owns project state and one-time secret reveal.
- Guide figures are rendered product diagrams plus the existing merchant console image; they explain operation steps without creating another payment surface.
- API examples document the project/API-key checkout boundary and deliberately exclude browser cookie checkout creation.
