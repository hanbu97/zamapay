# CardForge

Standalone merchant template for proving a Mermer Pay integration without mounting merchant product code inside the payment platform.

## Run

Start Mermer Pay API and web from the repository root first. In the Mermer Pay console, create a project, create an API key, and add this webhook URL:

```text
http://127.0.0.1:8092/api/mermer-pay/webhook
```

Copy the project id, one-time API key, and webhook secret into `backend/.env`. Then run the template from its own directories.

```bash
cd demo/cardforge/backend
cargo run
```

```bash
cd demo/cardforge/frontend
npm install
npm run dev -- --hostname 127.0.0.1 --port 3002
```

Optional local explorer links can be enabled for the wallet activity panel:

```bash
NEXT_PUBLIC_LOCAL_EXPLORER_URL=http://127.0.0.1:4000 npm run dev -- --hostname 127.0.0.1 --port 3002
```

When no local explorer is running, CardForge still records and displays the confirmed transaction hash.

## Boundary

- `frontend/` owns catalog UI and buyer intent.
- `backend/` owns Mermer Pay checkout creation, webhook receipt, and release policy.
- Mermer Pay owns login, project configuration, hosted checkout, invoice truth, finality, and settlement.
- The root Mermer Pay workspace does not start, build, lint, or import this template.
- CardForge uses `MERMER_PAY_PROJECT_ID` and `MERMER_PAY_API_KEY` only; it does not forward `mermer_session` cookies to Mermer Pay.
