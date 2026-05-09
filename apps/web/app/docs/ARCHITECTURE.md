# Docs Route Architecture

## Tree

```text
apps/web/app/docs
|-- layout.tsx       # Public docs shell that reuses marketing/PublicHeader and keeps navbar-aware content height
|-- page.tsx         # Docs index with first-viewport guide map and primary article entries
|-- DocsArticle.tsx  # Server-rendered article renderer, guide figures, tables, flow diagrams, and code blocks
|-- MermaidDiagram.tsx # Client renderer that dynamically loads Mermaid for docs diagrams
|-- docs-content.ts  # Static documentation truth for quickstart, API, webhooks, CardForge, privacy checkout, and environments
`-- [slug]/
    |-- page.tsx         # Static docs article route selected by slug
    `-- ARCHITECTURE.md  # Dynamic article route note
```

## Decisions

- Documentation is public because integration guidance must be readable before wallet login.
- The docs content is static TypeScript data, not MDX, so build output stays dependency-free and type checked.
- `/docs` opens directly into the documentation map; it is not a landing page stacked above a second docs layout.
- The docs body uses `100dvh - 3.5rem` as its minimum viewport while the shared public header owns top navigation.
- `/merchant` owns project state and one-time secret reveal.
- Privacy checkout documents the implemented local-dev mock confidential rail, MVP boundary, field contract, safety controls, and payment path as row-spanned tables plus Mermaid, so privacy claims stay narrower than the settlement proof.
- Mermaid is isolated in a client component and loaded dynamically; docs articles remain server-rendered and typed.
- Guide figures render only when a section declares one; text/table-only sections stay single-column and do not receive placeholder cards.
- API examples document the project/API-key checkout boundary and deliberately exclude browser cookie checkout creation.
