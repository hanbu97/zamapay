# Well-Known Skills Architecture

## Tree

```text
skills
|-- index.json/route.ts # Skill discovery manifest for coding agents
`-- zamapay/route.ts    # Public ZamaPay Skill Markdown
```

## Decisions

- `index.json` is intentionally small: skill name, description, URL, and `llms.txt` pointer.
- `zamapay/route.ts` serves Markdown only and has no runtime dependency on merchant sessions, API keys, or browser state.
