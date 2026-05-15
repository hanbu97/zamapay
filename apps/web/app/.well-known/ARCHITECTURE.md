# Well-Known Route Architecture

## Tree

```text
.well-known
`-- skills/
    |-- index.json/route.ts
    `-- zamapay/route.ts
```

## Decisions

- Well-known routes expose agent-readable integration metadata only; they do not accept credentials or mutate platform state.
- The ZamaPay Skill route reads `skills/zamapay/SKILL.md` so public agent guidance and repository guidance stay one file.
