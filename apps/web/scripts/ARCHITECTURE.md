# Web Scripts Architecture

## Tree

```text
apps/web/scripts
`-- run-e2e.mjs # Serial Node test runner for named e2e specs
```

## Decisions

- `run-e2e.mjs` maps RALPLAN-style file names such as `auth-login.spec.ts` to `apps/web/e2e/*`.
- Its default matrix covers auth, checkout, and operator failure drills so `verify:local:full` proves both happy path and incident visibility.
- E2E specs run with `--test-concurrency=1` because the Rust auth challenge store is intentionally single-use and address-scoped.
- The runner rejects paths outside `apps/web/e2e` so test selection cannot accidentally execute unrelated files.
