# Well-Known Route Architecture

## Tree

```text
.well-known
|-- zamapay.json/route.ts
`-- skills/
    |-- index.json/route.ts
    `-- zamapay/
        |-- route.ts
        `-- install.sh/route.ts
```

## Decisions

- Well-known routes expose agent-readable integration metadata only; they do not accept credentials or mutate platform state.
- `zamapay.json` is the top-level integration manifest for docs, package names, install URLs, skill URLs, and current release status.
- The ZamaPay Skill route reads `skills/zamapay/SKILL.md` so public agent guidance and repository guidance stay one file.
- The skill installer route emits a tiny shell script that copies that same skill into a local Codex skill directory.
