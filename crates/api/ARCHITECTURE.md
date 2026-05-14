# API Architecture

## Scope

- `src/lib.rs` owns the Axum router, nonce/signature auth, merchant session issue/delete, protected merchant write paths, public invoice/checkout reads, supported ERC20 asset discovery, operator diagnostics auth boundary, Zama indexer cursor exposure, EVM transfer/cursor projection, and generated contract-manifest reads.
- `src/billing.rs` owns session-authenticated subscription reads, cycle-aware private upgrade intents, and the operator-only entitlement projection path that turns verified registry events into the backend billing read model.
- `src/http_policy.rs` owns deploy-time HTTP edge policy: CORS origins, operator preflight headers, and session cookie attributes.
- `src/projects.rs` owns payment-project routes, merchant payment rail settings, project-secret bootstrap, API-key checkout quote/session creation, webhook endpoint management, secret rotation, Svix-style outbox delivery dispatch, test webhook, manual resend, withdraw read-model protection, and the single public demo-project overview exception.
- `src/runtime_profile.rs` reads `env/runtime-profiles.json` so the API shares contract environment and checkout URL defaults with the web app and scripts.
- `src/main.rs` awaits `AppState::new`, then binds the HTTP listener, preferring `ZAMAPAY_API_BIND`, falling back to Railway `PORT`, then local `127.0.0.1:18080`.
- `tests/*.rs` lock the auth boundary, subscription upgrades, merchant portal routes, and generated manifest exposure.
- Merchant invoice creation validates a positive minor-unit amount before persisting the read model and projecting the chain invoice metadata.
- Payment-project creation derives its billing projection from the active subscription; checkout-session responses return the immutable billing snapshot created by storage.
- Operator payment projection is guarded by the operator key and can target either the merchant invoice id or the chain invoice id emitted by finalized settlement events.
- Operator EVM transfer projection is guarded by the operator key and accepts only normalized ERC20 `Transfer` evidence with 20-byte addresses and 32-byte tx/block hashes; it writes the transfer ledger before invoice payment truth moves.
- Operator EVM cursor projection is guarded by the same key and stores chain/token/receiver scan progress so workers can resume from backend truth instead of local process memory.
- Operator subscription entitlement projection is guarded by the same operator key; dashboard sessions can request upgrade intents but cannot write paid fee entitlement.
- Operator confirmation projection stores the observed confirmation count and threshold on the invoice record before checkout or ops pages render finality-safe state.
- Operator-key failures are counted in process-local API state before 401 responses leave the boundary, then exposed through authorized diagnostics.
- Operator settlement events are guarded by the same operator key and target chain invoice ids, giving failure drills one projection path for decrypt timeout, replay guard, rollback, and deep reorg states.
- Operator webhook dispatch is retired with `410 Gone`; project outbox dispatch lives on the project delivery routes and signs frozen raw payloads with `svix-id`, `svix-timestamp`, and `svix-signature`.
- Operator webhook delivery projection remains guarded by the operator key for projection and fault drills only. It must not return merchant-signed payloads or replayable signature material.
- Merchant decrypt requests are first-class invoice actions; gateway callbacks use `ZAMAPAY_GATEWAY_CALLBACK_KEY` so Zama result delivery is separated from the operator key.
- Fulfillment reads are public checkout outputs; the first finality-safe read records one release audit without generating merchant-template artifacts.

## Decisions

- The API remains the only HTTP boundary for the web app.
- Hosted origins are explicit data via `ZAMAPAY_ALLOWED_ORIGINS`; localhost remains built in so local wallet and browser flows do not need Railway-only config.
- Cross-site Railway preview auth uses `ZAMAPAY_SESSION_COOKIE_SAMESITE=none` plus `ZAMAPAY_SESSION_COOKIE_SECURE=true`; local dev keeps the lax cookie default.
- `AppState::new` is async, requires `DATABASE_URL`, and uses the normalized Postgres portal schema as the source of truth; auth challenges and sessions stay process-local behind Tokio locks.
- `DELETE /api/session` clears both the process-local session and browser cookie; clients do not synthesize logout by hiding UI.
- Project secrets authenticate checkout quote/session creation and the server-side bootstrap endpoint that returns project id plus current webhook verifier context; chain invoice authority stays in the hosted project signer read model.
- Project payment rail settings are owner-session protected. Checkout creation rejects a disabled rail before creating private chain evidence or ERC20 payment intents.
- Subscription upgrade is split: dashboard sessions can create encrypted chain intents, but only the operator/indexer can project anchored chain entitlement into Rust.
- Upgrade intent responses expose registry/token coordinates plus manifest-projected plan code, charge amount, period length, and expected fee needed for the merchant wallet to encrypt the subscription change; the resulting tier is read from chain in the browser.
- Project checkout API responses include buyer-payable hosted checkout URL only after chain invoice authority and billing split have both been recorded.
- Public checkout reads expose the invoice, optional checkout session, optional EVM payment intent, and intent-specific EVM asset so the hosted buyer page can render leased receiver payments without falling back to the available-address catalog.
- Supported ERC20 assets are exposed as a derived public read model; disabled chains, missing RPC nodes, missing receiver addresses, or disabled tokens disappear from the response.
- Project checkout quote responses expose the immutable fee split and merchant owner wallet needed by the local-dev chain invoice bridge before the checkout session is persisted.
- Project withdraw writes are blocked until a wallet-signed settlement contract transaction exists; the API may display historic read-model rows but must not create payout records from session auth alone.
- Project overview reads stay owner-session protected except for the env-selectable public demo project id; all project mutation routes still require the owner session or project-secret path already assigned to them.
- Generated contract truth is served from here so frontend code does not need to inspect Hardhat artifact folders directly.
- Contract manifests are served through `/api/contracts/{environment}`. Unknown environments fail closed; generated local-dev and Sepolia manifests are the only intended active inputs.
- Runtime profile JSON is the source for active contract environment and checkout URL defaults; Rust does not keep a second local-dev checkout fallback.
