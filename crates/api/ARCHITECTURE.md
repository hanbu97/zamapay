# API Architecture

## Scope

- `src/lib.rs` owns the Axum router, nonce/signature auth, merchant session cookies, protected merchant write paths, public invoice reads, operator diagnostics auth boundary, indexer cursor exposure, and generated contract-manifest reads.
- `src/projects.rs` owns payment-project routes, API-key checkout creation, webhook endpoint management, outbox delivery dispatch, test webhook, and manual resend.
- `src/main.rs` binds the HTTP listener, defaulting to `127.0.0.1:8080` while allowing `MERMER_API_BIND` for isolated local verification.
- `tests/*.rs` lock the auth boundary, merchant portal routes, and generated manifest exposure.
- Merchant invoice creation validates a positive minor-unit amount before persisting the read model and projecting the chain invoice metadata.
- Operator payment projection is guarded by the operator key and can target either the merchant invoice id or the chain invoice id emitted by finalized settlement events.
- Operator confirmation projection stores the observed confirmation count and threshold on the invoice record before checkout or ops pages render finality-safe state.
- Operator-key failures are counted in process-local API state before 401 responses leave the boundary, then exposed through authorized diagnostics.
- Operator settlement events are guarded by the same operator key and target chain invoice ids, giving failure drills one projection path for decrypt timeout, replay guard, rollback, and deep reorg states.
- Operator webhook dispatch and delivery projection are guarded by the same operator key and target chain invoice ids, giving signed payload, retry, dead-letter, and recovery drills one HTTP path.
- Merchant decrypt requests are first-class invoice actions; gateway callbacks use `MERMER_GATEWAY_CALLBACK_KEY` so Zama result delivery is separated from the operator key.
- Fulfillment reads are public checkout outputs; the first finality-safe read records one release audit without generating merchant-template artifacts.

## Decisions

- The API remains the only HTTP boundary for the web app.
- `AppState::new` enables portal file persistence when `MERMER_PORTAL_STORE_PATH` is set, while auth challenges and sessions remain process-local.
- Project API keys authenticate only the project checkout surface; chain invoice authority stays in the hosted project signer read model.
- Generated contract truth is served from here so frontend code does not need to inspect Hardhat artifact folders directly.
- Contract manifests are available through `/api/contracts/{environment}` with local aliases resolving to `local-dev`.
