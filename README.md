# ZamaPay

Confidential merchant checkout for wallet-authenticated merchants, Zama FHEVM settlement, and finality-gated webhook release.

## What Is Implemented

- Rust API: nonce login, cookie sessions, dashboard read model, invoice APIs, Zama chain projection, ERC20 asset/payment-intent/settlement-ledger projection, finality, and fulfillment release.
- Next.js web app: shadcn merchant homepage, wallet login, dashboard, hosted checkout for Zama private or ERC20 settlement rails, and operator diagnostics.
- Server SDK preview: `@zamapay/server` for merchant backends, explicit payment rail checkout creation, and raw-body webhook verification helpers.
- Contracts: merchant registry, official-style confidential token mock, private checkout settlement, local standard USDT/USDC mocks, local deploy, tests, and smoke scripts.
- Generated clients: ABI and address manifests flow from Hardhat into `generated/*` for Rust and web.

## Local Platform

Tooling is pinned by `.mise.toml` for Node and `just`; Rust is intentionally not managed there because this workspace already uses the newly upgraded Rust toolchain.

```bash
mise trust
mise install
mise exec -- just --list
mise exec -- just setup
```

The `Justfile` is the human entrypoint. It delegates to `env/`, `scripts/`, `npm`, `cargo`, and Hardhat instead of duplicating chain ids, URLs, finality, or secrets.
Local API recipes default to `http://127.0.0.1:18080` to avoid common `8080` conflicts. Override the whole local workflow with `ZAMAPAY_LOCAL_API_PORT=<port> just api-local` and use the same variable for `just web-local`, `just cardforge-api-local`, `just verify-local`, or `just verify-full`.

The workflow contract lives in [`docs/runbooks/development-deployment-workflow.md`](docs/runbooks/development-deployment-workflow.md). Follow that runbook for local-dev, CardForge binding, Supabase-backed local runs, Sepolia local-UI, preview checks, and recovery. The short path below is only the common local loop.

Public documentation is single-sourced from [`docs/content/public`](docs/content/public). The Next.js `/docs` route renders those Markdoc files directly; React and TypeScript files own rendering, not article prose. Use this gate after changing docs copy, SDK examples, rail wording, credential names, or docs navigation:

```bash
just docs-check
```

The same Markdoc source feeds AI-readable integration surfaces:

- `/llms.txt` is the compact agent entrypoint.
- `/llms-full.txt` is the full public docs corpus.
- `/docs/{slug}.md` exposes every guide as clean Markdown without frontmatter or Markdoc UI tags.
- `/docs/manifest.json` lists docs pages, Markdown URLs, and required integration guardrails.
- `/.well-known/skills/zamapay` serves the ZamaPay Skill for coding agents.

The ZamaPay Skill is also committed under [`skills/zamapay`](skills/zamapay). It hard-codes the integration rules agents must not infer: `ZAMAPAY_SECRET_KEY` stays server-side, checkout creation always sends explicit `paymentRail`, webhook receivers verify raw bytes before JSON parsing, EVM and Zama rails keep separate truth sources, and withdraw, delivery resend, project secret revoke, or webhook secret rotation require human confirmation.

Use the right integration surface for the job:

| Surface | Best for | Contract |
| --- | --- | --- |
| `/docs` | Humans reading the product and workflow docs | Rendered Markdoc from `docs/content/public`. |
| `/llms.txt` and `/docs/manifest.json` | Coding agents that need the shortest safe integration map | Absolute URLs plus guardrails derived from the same public docs source. |
| `/.well-known/skills/zamapay` | Codex, Claude, Cursor, or other skill-aware agents | Hard rules for secrets, rails, webhooks, and human-confirmed money movement. |
| `@zamapay/server` | Node merchant backends | Typed server SDK with project-secret auth, fixed API version, idempotency, rail-specific checkout inputs, and raw-body webhook helpers. |
| Raw HTTP | Non-Node merchant backends | The stable protocol behind the SDK. |
| `zamapay` Rust CLI | Local smoke tests and deterministic agent commands | Verifies env, checkout creation, and webhook signatures without becoming a custody tool. |

Run these in separate terminals from the repo root.

```bash
just db-up
just contracts-node
```

```bash
just reset-local
just api-local
```

```bash
just evm-indexer-local
```

```bash
just web-local
```

Service environment contracts live under `env/`. Files ending in `.env.example` are safe templates; same-name `.env` files contain local secrets and are ignored by git. Projects, project secrets, checkout sessions, payment projections, subscriptions, webhook state, and withdrawal read models use normalized Postgres tables as the single portal source of truth.

Use `just reset-local` after every Hardhat Local reset, before starting the API, web app, and CardForge backend. It recreates both local databases, `zamapay` and `cardforge`, redeploys contracts, refreshes generated clients, and clears local Next/Turbopack caches so chain ids, invoice ids, balances, fulfillment records, and CSS variables stay aligned.

For ordinary ERC20 checkout testing, keep `just evm-indexer-local` running beside the API. The local deploy writes transparent USDT/USDC mock addresses and `EvmCheckoutSettlement` into the generated manifest; the backend derives supported ERC20 assets from enabled chain, token, RPC, and settlement-contract rows, and payment truth moves only after the indexer observes block-hash-backed `EvmPaymentAccepted` events.

Use the dedicated local ERC20 rail proof when changing this path:

```bash
just verify-evm-local
```

It creates a local merchant project secret, opens an `evm_erc20` checkout, verifies the hosted checkout entry at `http://127.0.0.1:3001/checkout/{checkoutSessionId}`, approves exact local USDT from a Hardhat buyer account, pays through `EvmCheckoutSettlement`, runs one indexer pass, and asserts the checkout reaches `paid` plus `finality_safe`. For browser inspection before payment, use:

```bash
just verify-evm-local --prepare-only
```

Then open the printed `checkoutUrl`; the buyer-facing entry must show `ERC20 hosted checkout`, network/token/settlement contract/expiry details, copy/refresh controls, and the `Pay through settlement` wallet action.

Use the server SDK smoke when changing `packages/zamapay-server` or merchant API contracts:

```bash
just build-sdk
just verify-sdk-install-shape
just verify-sdk-local
```

`just build-sdk` emits the ESM/CJS package `dist/` artifacts used by npm exports. `just verify-sdk-install-shape` installs that built package into standalone CJS, ESM, TS, type-only, esbuild, and webhook receiver projects. `just verify-sdk-local` reads the ignored local CardForge backend env, bootstraps the project through `ZAMAPAY_SECRET_KEY`, creates one `evm_erc20` checkout with explicit `paymentRail`, then retrieves it through the SDK. Contract tests cover both `zama_private` and `evm_erc20` rails.

Use the Rust CLI for deterministic local merchant integration and control-plane checks:

```bash
just build-cli
just verify-cli
cargo run -p zamapay-cli -- doctor
cargo run -p zamapay-cli -- init --api-url http://127.0.0.1:18080
cargo run -p zamapay-cli -- login --private-key-stdin
cargo run -p zamapay-cli -- project create --name "CardForge local" --link --create-secret
cargo run -p zamapay-cli -- rail enable --payment-rail evm_erc20
cargo run -p zamapay-cli -- webhook create --url http://127.0.0.1:8092/api/zamapay/webhook --export-env
cargo run -p zamapay-cli -- checkout create --payment-rail evm_erc20 --merchant-order-id order_123 --title "Test order" --amount-label "10 USDT" --amount-minor-units 10000000 --evm-chain-id 31337 --evm-token-symbol USDT
cargo run -p zamapay-cli -- delivery resend --delivery-id del_123 --yes
cargo run -p zamapay-cli -- webhook rotate-secret --endpoint-id we_123 --yes --export-env
cargo run -p zamapay-cli -- verify-webhook --body-file webhook.json --svix-id msg_123 --svix-timestamp 1778760000 --svix-signature "v1,..." --secret "$ZAMAPAY_WEBHOOK_SECRET"
cargo run -p zamapay-cli -- test-webhook --url http://127.0.0.1:8092/api/zamapay/webhook
```

`zamapay login` signs the existing wallet nonce locally and stores only the resulting session id in `~/.zamapay/config.json`. `ZAMAPAY_SECRET_KEY` remains the merchant backend runtime secret and is not a control-plane owner credential.
Money-moving or invalidating operations are CLI-supported but guarded: `withdraw`, `delivery resend`, `secret revoke`, and `webhook rotate-secret` require `--yes`.

If a local browser page looks stale after branch churn, env changes, or a design-token rename, run:

```bash
just clean-local-dev
```

The local and Sepolia `just *web*local*` recipes already clear their own `.next` caches before starting.

CardForge is a separate merchant demo and uses its own database URL:
`CARDFORGE_DATABASE_URL=postgres://zamapay:zamapay@127.0.0.1:5432/cardforge`.
Fresh Docker volumes create both `zamapay` and `cardforge`; for an existing volume, run
`docker exec zamapay-postgres createdb -U zamapay cardforge` once if the CardForge database is missing.

For a Supabase-backed local run, let the recipe compose local-dev first and the Supabase override second:

```bash
just api-supabase-local
```

Open:

- `http://127.0.0.1:3001/dashboard`
- `http://127.0.0.1:3001/ops`
- `http://127.0.0.1:3001/merchant`

Standalone merchant templates live under `demo/` and are launched from their own directories. The ZamaPay root scripts do not start, build, or lint template projects.

For CardForge project binding, either run `just seed-cardforge-local-project` or create a project in the merchant console and copy the one-time `ZAMAPAY_SECRET_KEY` export into the ignored `env/local-dev.cardforge-backend.env`. The `zms_test_...` value is a server-side project secret: CardForge uses it to create checkouts and to bootstrap project id plus webhook verifier context from ZamaPay at startup. `ZAMAPAY_API_URL`, CardForge database/store, `CARDFORGE_PAYMENT_RAIL`, EVM asset selectors, and optional private-rail helper URLs stay in the checked env templates. Use `CARDFORGE_PAYMENT_RAIL=evm_erc20` with `CARDFORGE_EVM_CHAIN_ID=31337` and `CARDFORGE_EVM_TOKEN_SYMBOL=USDT` when validating the ordinary ERC20 rail from the demo storefront. `ZAMAPAY_SECRET_ENCRYPTION_KEY` is server-only for ZamaPay API encrypted endpoint-secret storage. Webhooks use Svix-style `svix-*` headers and HMAC-SHA256 over the raw request body. Use the browser-created project path when validating merchant-wallet withdraw because the project owner must match the MetaMask merchant account.

Node merchant backends can use `@zamapay/server` with `ZAMAPAY_SECRET_KEY` and `ZAMAPAY_API_URL`. Keep that SDK server-side. CardForge remains a Rust raw HTTP baseline, not TypeScript SDK dogfood.

Run the full local readiness gate after API, web, and Hardhat are running:

```bash
just verify-local
```

This checks the local manifest, Rust API, Next pages, browser projection route, and hosted checkout rendering.
It also signs a Rust auth nonce with `ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY`, proves that the resulting `zamapay_session` cookie can render the protected dashboard, and verifies the local browser signer route is disabled unless explicitly enabled.
For manual browser-only `LoginCard` verification without a wallet extension, temporarily start the web server with `ZAMAPAY_ENABLE_DEV_SIGNER=1`; leave it disabled for normal local runs and future public-testnet runs.

## Public Testnet

Public-testnet work is guarded by explicit runtime profiles and env files. The active local MVP remains Hardhat/FHEVM mock RPC, `ConfidentialUSDMock.claimTestTokens()` from the browser wallet, direct buyer-wallet payment, encrypted pending buckets, merchant-signed withdraw, and local chain evidence projection after finalization.

The ordinary EVM ERC20 rail is a separate non-private rail. Public ERC20 support should be enabled only by explicit chain/token/RPC/settlement-contract catalog rows. Payment truth must come from indexed `EvmCheckoutSettlement.EvmPaymentAccepted` events, confirmation thresholds, and settlement ledger states, not manual tx-hash projection or buyer-chosen payment destinations.

Sepolia local-UI and preview setup lives in [`env/README.md`](env/README.md) and the workflow runbook. Use these entrypoints instead of hand-sourcing env stacks:

```bash
just verify-runtime sepolia-local-ui
just deploy-sepolia-contracts
just api-sepolia-local-ui
just web-sepolia-local-ui
just cardforge-api-sepolia-local-ui
just cardforge-web-sepolia-local-ui
```

Before a public preview deploy, run:

```bash
just preview-check
```

## Verification Commands

```bash
just verify-full
```

For individual gates:

```bash
just check
just build-sdk
just verify-sdk-install-shape
just build-web
just verify-sdk-local
just verify-local
```

`just check` starts or reuses local Postgres because Rust integration tests need a database URL.
