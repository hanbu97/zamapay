# API Architecture

## Scope

- `src/lib.rs` owns the Axum router, nonce/signature auth, merchant session issue/delete, protected merchant write paths, public invoice reads, operator diagnostics auth boundary, indexer cursor exposure, and generated contract-manifest reads.
- `src/billing.rs` owns session-authenticated subscription reads, cycle-aware private upgrade intents, and the operator-only entitlement projection path that turns verified registry events into the backend billing read model.
- `src/projects.rs` owns payment-project routes, API-key checkout quote/session creation, webhook endpoint management, outbox delivery dispatch, test webhook, manual resend, and withdraw read-model protection.
- `src/main.rs` awaits `AppState::new`, then binds the HTTP listener, defaulting to `127.0.0.1:8080` while allowing `ZAMAPAY_API_BIND` for isolated local verification.
- `tests/*.rs` lock the auth boundary, subscription upgrades, merchant portal routes, and generated manifest exposure.
- Merchant invoice creation validates a positive minor-unit amount before persisting the read model and projecting the chain invoice metadata.
- Payment-project creation derives its billing projection from the active subscription; checkout-session responses return the immutable billing snapshot created by storage.
- Operator payment projection is guarded by the operator key and can target either the merchant invoice id or the chain invoice id emitted by finalized settlement events.
- Operator subscription entitlement projection is guarded by the same operator key; dashboard sessions can request upgrade intents but cannot write paid fee entitlement.
- Operator confirmation projection stores the observed confirmation count and threshold on the invoice record before checkout or ops pages render finality-safe state.
- Operator-key failures are counted in process-local API state before 401 responses leave the boundary, then exposed through authorized diagnostics.
- Operator settlement events are guarded by the same operator key and target chain invoice ids, giving failure drills one projection path for decrypt timeout, replay guard, rollback, and deep reorg states.
- Operator webhook dispatch and delivery projection are guarded by the same operator key and target chain invoice ids, giving signed payload, retry, dead-letter, and recovery drills one HTTP path.
- Merchant decrypt requests are first-class invoice actions; gateway callbacks use `ZAMAPAY_GATEWAY_CALLBACK_KEY` so Zama result delivery is separated from the operator key.
- Fulfillment reads are public checkout outputs; the first finality-safe read records one release audit without generating merchant-template artifacts.

## Decisions

- The API remains the only HTTP boundary for the web app.
- `AppState::new` is async, requires `DATABASE_URL`, and uses the normalized Postgres portal schema as the source of truth; auth challenges and sessions stay process-local behind Tokio locks.
- `DELETE /api/session` clears both the process-local session and browser cookie; clients do not synthesize logout by hiding UI.
- Project API keys authenticate only checkout quote/session creation; chain invoice authority stays in the hosted project signer read model.
- Subscription upgrade is split: dashboard sessions can create encrypted chain intents, but only the operator/indexer can project anchored chain entitlement into Rust.
- Upgrade intent responses expose registry/token coordinates plus manifest-projected plan code, charge amount, period length, and expected fee needed for the merchant wallet to encrypt the subscription change; the resulting tier is read from chain in the browser.
- Project checkout API responses include buyer-payable hosted checkout URL only after chain invoice authority and billing split have both been recorded.
- Project checkout quote responses expose the immutable fee split and merchant owner wallet needed by the local-dev chain invoice bridge before the checkout session is persisted.
- Project withdraw writes are blocked until a wallet-signed settlement contract transaction exists; the API may display historic read-model rows but must not create payout records from session auth alone.
- Generated contract truth is served from here so frontend code does not need to inspect Hardhat artifact folders directly.
- Contract manifests are served through `/api/contracts/{environment}`. Unknown environments fail closed; generated local-dev and Sepolia manifests are the only intended active inputs.
