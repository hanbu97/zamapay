# ZamaPay Skill Architecture

## Tree

```text
skills
`-- zamapay/
    |-- SKILL.md
    |-- ARCHITECTURE.md
    `-- agents/openai.yaml
```

## Decisions

- `skills/zamapay` is the public integration skill for coding agents that help merchants add ZamaPay to their own backends.
- The skill contains policy and workflow only; public docs under `docs/content/public` remain the article source of truth.
- The skill forbids browser secrets, implicit payment rails, post-parse webhook verification, rail truth mixing, and silent money-moving operations.
