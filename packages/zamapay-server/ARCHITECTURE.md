# ZamaPay Server SDK Architecture

## Tree

```text
zamapay-server/
|-- package.json           # npm workspace package metadata and exports
|-- tsconfig.build.cjs.json # CommonJS package emit config
|-- tsconfig.build.esm.json # ESM package emit config
|-- tsconfig.json          # Strict TypeScript check for the preview package
|-- scripts/
|   |-- clean-dist.mjs     # Removes stale package build artifacts before emit
|   `-- write-dist-package-types.mjs # Marks ESM/CJS dist folders with runtime type
|-- src/
|   |-- client.ts          # Merchant resource surface and rail-specific checkout input boundary
|   |-- errors.ts          # Stable SDK error hierarchy and API error normalization
|   |-- index.ts           # Public server SDK entrypoint
|   |-- rails.ts           # Payment rail constants and input validation
|   |-- request.ts         # Single request sender for headers, timeout, retry, and lastResponse
|   `-- webhooks.ts        # Svix-style raw-body HMAC verifier
|-- test-projects/
|   |-- cjs/               # Installs built package through require()
|   |-- esm/               # Installs built package through ESM import
|   |-- ts-esm/            # Installs built package in a TS ESM runtime
|   |-- types/             # Compiles merchant-facing .d.ts contracts
|   |-- esbuild/           # Bundles the package and checks error identity survives minify
|   `-- webhook-node/      # Runs a native Node receiver with generated Svix-style test headers
`-- tests/                 # Node test runner contract, protocol, and install-shape harness tests
```

## Decisions

- `@zamapay/server` is server-only: it uses native `fetch` and `node:crypto`, and must never be imported from `NEXT_PUBLIC_*` browser code.
- Package exports point at `dist/esm` and `dist/cjs`; tests can still import `src/` directly so contract tests exercise source before build.
- Install-shape tests are intentionally separate from the fast package test. They install `@zamapay/server` through `file:../..` into standalone merchant-shaped projects and run behind `just verify-sdk-install-shape`.
- Checkout creation is a discriminated union: `zama_private` carries chain invoice evidence, `evm_erc20` carries network/token selection and returns settlement-contract payment intent data.
- `request.ts` is the only place that owns HTTP transport policy: auth headers, API version, user agent, timeout, retry, `Retry-After`, request id, and `lastResponse`.
- API errors are typed by server envelope and status so merchant code can distinguish auth, permission, invalid request, idempotency, rate limit, connection, and timeout failures.
- Webhook helpers stay under `@zamapay/server/webhooks`; there is no separate `@zamapay/webhooks` package.
- Webhook tests use SDK-generated Svix-style headers; verification still requires raw bytes before JSON parsing.
- Contract tests consume `fixtures/merchant-api/contract-v1.json`; local smoke lives behind `just verify-sdk-local`.
