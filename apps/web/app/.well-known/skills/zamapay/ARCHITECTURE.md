# ZamaPay Skill Route Architecture

## Tree

```text
apps/web/app/.well-known/skills/zamapay
|-- route.ts          # Public Markdown for the committed ZamaPay skill
|-- install.sh/       # Public shell installer for the same skill
`-- ARCHITECTURE.md   # Route note
```

## Decisions

- `route.ts` reads `skills/zamapay/SKILL.md`; there is no copied skill body in the Next route.
- `install.sh/` exists only to install that same skill locally, keeping guidance and installation coupled to one source.
