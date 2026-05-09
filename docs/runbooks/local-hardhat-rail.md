# Local Hardhat Rail

## Purpose

Bring up a stable local chain, deploy the Mermer contracts, refresh `generated/*`, and confirm that Rust + web read the same manifest truth.

## Steps

1. Start local Postgres:

```bash
docker compose up -d postgres
```

2. Start a persistent local chain:

```bash
npm --workspace contracts run node
```

3. In another terminal, deploy contracts onto `localhost` and refresh generated clients:

```bash
npm --workspace contracts run deploy:localhost
```

4. Confirm the generated manifest now contains non-null addresses:

```bash
cat generated/contracts/addresses/local-dev.json
```

5. Start the Rust API:

```bash
DATABASE_URL=postgres://mermer:mermer@127.0.0.1:5432/mermer cargo run -p api
```

6. Start the web app:

```bash
npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001
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
npm run verify:local
```

## Notes

- `deploy:local` uses Hardhat's ephemeral network and is useful for fast validation, but its addresses die with the process.
- `deploy:localhost` is the stable path for real end-to-end local integration.
- `DATABASE_URL` persists projects, API keys, checkout sessions, invoices, operator projections, webhook outbox state, subscriptions, and withdrawal read models in normalized Postgres tables; auth sessions stay process-local.
- `MERMER_PORTAL_STATE_KEY` is only for isolated local verification namespaces; normal local development uses the default `portal` row.
- `NEXT_PUBLIC_CONTRACT_ENV=local-dev` is the default frontend manifest selector.
- `demo/cardforge` is the independent card issuing merchant example. It starts from Mermer Pay project config and calls the configured Mermer Pay API/checkout URLs.
- Browser-created platform checkouts ask the injected wallet to switch or add chain `31337` before writing merchant registry or settlement transactions.
- `/api/checkout/project-finalized-payment` projects only finalized `PrivatePaymentFinalized` transactions from `PrivateCheckoutSettlement`.
- The old transparent invoice smoke and public-testnet readiness scripts are intentionally removed; local-dev is the only active environment until Zama protocol-fee handling is designed.
- `verify:local` checks the local manifest, Rust API, Next pages, wallet login, and dev-signer boundary.
- Browser payment uses the hosted checkout page: wallet signs a local private intent, the Mermer Pay relayer submits encrypted payment, local FHEVM decrypts only `accepted`, then Rust projects finality and fulfillment.
