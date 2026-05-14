# Fixtures Architecture

## Tree

```text
fixtures/
`-- merchant-api/          # Merchant-facing SDK/API contract examples shared by Rust and TypeScript tests
```

## Decisions

- Fixtures are executable contract evidence, not prose examples.
- Merchant API fixtures must be consumed by both Rust contract tests and SDK tests before docs rely on them.
- Webhook vectors live here so raw-body signing has one source of truth across the Rust verifier and `@zamapay/server`.
