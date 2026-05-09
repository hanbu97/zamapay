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
curl http://127.0.0.1:8080/api/contracts/localhost
curl -I http://127.0.0.1:3001/dashboard
curl -I http://127.0.0.1:3002
curl http://127.0.0.1:8080/api/invoices/demo-card-001
```

8. Smoke a full merchant-owned invoice creation and settlement path:

```bash
npm --workspace contracts run smoke:local-invoice
```

9. Run the full local readiness gate after Hardhat, Rust API, and Next web are all running:

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
- `/api/checkout/project-finalized-payment` can project a finalized local payment tx after verifying `InvoicePaid` from the current settlement contract; the CLI projection script is still useful for deterministic smoke runs.
- `smoke:local-invoice` signs the Rust nonce with the Hardhat merchant wallet, writes `createInvoice` with a canonical minor-unit amount, mints confidential test USD to the buyer, encrypts buyer approval against the token contract, encrypts payment against settlement, publicly decrypts the payment-check handle, calls `finalizePayment`, projects by chain invoice id, advances confirmations past the finality threshold, then confirms demo card-code fulfillment release.
- `verify:local` wraps the full local payment boundary: manifest, Rust API, Next pages, local confidential payment smoke, browser projection route, and checkout card-code rendering.
- Local smoke is deterministic and does not require browser relayer setup.
