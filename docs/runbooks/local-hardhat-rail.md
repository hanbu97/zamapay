# Local Hardhat Rail

## Purpose

Bring up a stable local chain, deploy the ZamaPay contracts, refresh `generated/*`, and confirm that Rust + web read the same manifest truth.

## Steps

1. Start local Postgres:

```bash
just db-up
```

2. Start a persistent local chain:

```bash
just contracts-node
```

3. In another terminal, reset local-dev state, deploy contracts onto `localhost`, refresh generated clients, and clear local web caches:

```bash
just reset-local
```

4. Confirm the generated manifest now contains non-null addresses:

```bash
cat generated/contracts/addresses/local-dev.json
```

5. Start the Rust API:

```bash
just api-local
```

6. Start the web app:

```bash
just web-local
```

7. Smoke the shared truth surface:

```bash
curl http://127.0.0.1:8080/api/contracts/local-dev
curl -I http://127.0.0.1:3001/dashboard
curl -I http://127.0.0.1:3002
curl http://127.0.0.1:8080/api/invoices/demo-card-001
```

8. Run the local readiness gate after Hardhat, Rust API, and Next web are all running:

```bash
just verify-local
```

## Notes

- `deploy:local` uses Hardhat's ephemeral network and is useful for fast validation, but its addresses die with the process.
- `just reset-local` is the stable path for real end-to-end local integration after a Hardhat Local reset. Run it before starting the API, web app, and CardForge backend. It recreates both local Postgres databases, `zamapay` and `cardforge`, deploys contracts, refreshes generated clients, and clears local Next/Turbopack caches so chain-local state, read models, generated types, and CSS variables cannot drift.
- `just clean-local-dev` is the explicit cache-only recovery path when a running local UI looks stale after branch churn, env changes, or design-token renames. Restart the affected web server after using it.
- `deploy:localhost` is contract-only; use it only when you deliberately want to keep existing local database rows.
- `env/` is the service environment contract. Commit only `*.env.example`; same-name `*.env` files contain local secrets and are ignored by git.
- `DATABASE_URL` in `env/local-dev.zamapay-api.env` persists projects, API keys, checkout sessions, invoices, operator projections, webhook outbox state, subscriptions, and withdrawal read models in normalized Postgres tables; auth sessions stay process-local.
- Supabase-backed local runs use `just api-supabase-local`. The override changes only the ZamaPay Postgres host; the chain remains local Hardhat/FHEVM mock.
- `ZAMAPAY_PORTAL_STATE_KEY` is only for isolated local verification namespaces; normal local development uses the default `portal` row.
- `NEXT_PUBLIC_RUNTIME_PROFILE=local-dev` in `env/local-dev.zamapay-web.env` is the frontend manifest selector.
- `demo/cardforge` is the independent card issuing merchant example. It starts from `env/local-dev.cardforge-backend.env`, optional `env/supabase.cardforge-backend.env`, and the project credentials shown once by ZamaPay.
- Browser-created platform checkouts ask the injected wallet to switch or add chain `31337` before writing merchant registry or settlement transactions.
- `/api/checkout/project-finalized-payment` projects only finalized `PrivatePaymentFinalized` transactions from `PrivateCheckoutSettlement`.
- The old transparent invoice smoke scripts are intentionally removed; public-testnet setup now enters through `env/runtime-profiles.json` and `just` recipes instead of ad hoc readiness scripts.
- `just verify-local` checks the local manifest, Rust API, Next pages, wallet login, and dev-signer boundary.
- Browser payment uses the hosted checkout page: the buyer wallet submits encrypted payment directly, local FHEVM decrypts only `accepted`, then Rust projects finality and fulfillment.
