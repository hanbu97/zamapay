# Well-Known Skills Architecture

## Tree

```text
skills
|-- index.json/route.ts # Skill discovery manifest for coding agents
`-- zamapay/
    |-- route.ts        # Public ZamaPay Skill Markdown
    `-- install.sh/route.ts # Shell installer for local Codex skill setup
```

## Decisions

- `index.json` is intentionally small: skill name, description, URL, install URL, and `llms.txt` pointer.
- `zamapay/route.ts` serves Markdown only and has no runtime dependency on merchant sessions, API keys, or browser state.
- `zamapay/install.sh/route.ts` serves an installer script only; it never embeds credentials and only writes local skill files.
