# Docs Markdown Route Architecture

## Tree

```text
markdown
|-- route.ts
`-- ARCHITECTURE.md
```

## Decisions

- This internal route renders one public guide as Markdown from `docs/content/public`.
- `next.config.ts` rewrites `/docs/{slug}.md` here so external AI-readable URLs keep a normal `.md` shape while App Router params stay type-safe.
