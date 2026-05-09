# Web E2E Architecture

## Tree

```text
apps/web/e2e
|-- auth-login.spec.ts              # Live API + web nonce login, session cookie, and dashboard guard proof
|-- checkout-flow.spec.ts           # Live local confidential payment smoke, merchant route, web projection route, and hosted checkout state proof
|-- operator-failure-drills.spec.ts # Live operator incident projection proof through the backend diagnostics API
`-- support/
    |-- auth.ts                     # Shared Rust nonce/signature login helper
    `-- http.ts                     # Shared live-service HTTP client helpers
```

## Decisions

- E2E specs use Node's built-in test runner plus existing workspace dependencies; no browser-test dependency is added.
- These specs assume Rust API, Next web, Hardhat localhost, and the local manifest are already running, matching `verify:local`.
- Specs are executed serially by `apps/web/scripts/run-e2e.mjs` because login challenges are intentionally single-use.
- `support/*` holds transport/session mechanics only; scenario files keep all business assertions local and readable.
- `auth-login.spec.ts` signs a real Rust nonce and checks both anonymous redirect and authenticated dashboard render.
- `checkout-flow.spec.ts` reuses the contract smoke path, then proves `/merchant`, the web projection route, and checkout page agree on finalized payment, finality depth, release-gate state, and webhook status without merchant-template artifacts.
- `operator-failure-drills.spec.ts` scripts expired invoice, webhook dead-letter, rollback before threshold, decrypt timeout, replay guard, deep reorg, frozen fulfillment, duplicate decrypt-request guard, operator auth rejection, finality depth, and indexer-stalled cursor states, then verifies the backend diagnostics projection.
