# Mermer Pay Initial Consensus Plan

Last updated: 2026-05-06
Mode: RALPLAN-DR consensus

## Principles

1. Zama confidentiality must be payment-critical, not decorative.
2. Ship one boringly reliable closed loop before adding rails, chains, or merchant types.
3. Contracts own settlement truth; Rust owns projections, sessions, webhooks, and fulfillment.
4. Reuse gateway patterns from `refs/epusdt`, but replace wallet-polling logic with contract-event settlement.
5. The demo must end in real merchant fulfillment, not only a paid-on-chain screenshot.

## Decision Drivers

1. End-to-end demo reliability across login, wallet, relayer, contracts, backend, and fulfillment.
2. Real Zama depth: encrypted inputs, ACL, relayer flow, and merchant-visible confidential settlement.
3. MVP speed without creating a fake gateway architecture that must be thrown away immediately.

## Viable Options

### Option A — Zama-native confidential checkout

Shape:
- Next.js merchant app + buyer checkout
- Rust API/domain/indexer/webhook services
- FHEVM contracts for merchant registry, confidential token, confidential invoice settlement
- Zama Sepolia settlement contracts as the only payment rail in MVP, with the official relayer handling encrypted inputs and decrypt requests

Pros:
- Strongest "real Zama" story
- Smallest truth surface
- Best fit for `refs/zama/fhevm-skill` and `private-voting`
- Simplest path to deterministic testnet demo

Cons:
- Less familiar than classic crypto gateway top-up flows
- Requires demo token mint/faucet/distribution path
- Wallet-first UX must be explained clearly

### Option B — Hybrid public gateway + Zama confidential ledger

Shape:
- Rust backend mirrors `epusdt` gateway flow for public-chain ingress
- Zama contracts hold confidential settlement, fee, or split data
- Backend reconciles public payment events with Zama-side invoice state

Pros:
- More recognizable gateway story
- Easier future path to non-Zama rails
- Strong conceptual reuse of `refs/epusdt`

Cons:
- Two sources of truth
- Higher failure surface for demo day
- High risk that Zama becomes a sidecar instead of the product core

## ADR

Decision:
- Choose Option A for the initial build.

Drivers:
- Keeps confidentiality on the settlement-critical path
- Matches the required sequence with the fewest moving parts
- Preserves a future bridge to hybrid rails after the core loop works

Alternatives considered:
- Option B: rejected for MVP because reconciliation complexity is too high
- Public hosted checkout with auxiliary Zama metadata: invalid because it violates the brief

Why chosen:
- It is the only option that is both credibly confidential and small enough to verify end to end in hackathon conditions.

Consequences:
- Wallet-first login and payment are mandatory in MVP
- Demo token economics and buyer funding UX must be part of the runbook
- Merchant-facing confidential revenue views must be derived from Zama ACL/decrypt flow, not plain backend duplication
- Payment confirmation must not depend on synchronous merchant decrypt success

Follow-ups:
- After MVP, add hybrid ingress as a second rail rather than changing the core architecture

## Chosen Option And Why

Chosen:
- Option A — Zama-native confidential checkout with Rust backend and Next.js 16.2 frontend.

Why:
- It satisfies all hard constraints directly.
- It makes Zama the system, not the garnish.
- It lets `epusdt` inform order lifecycle, webhook retry, admin diagnostics, and status APIs without inheriting its public-chain listener complexity.

## Workspace Blueprint

Target workspace layout:
- `apps/web` — Next.js 16.2 App Router merchant + buyer UI
- `contracts/` — Hardhat FHEVM project for Zama Sepolia contracts and deploy scripts
- `crates/api` — Rust HTTP API, auth nonce/session, merchant/admin endpoints
- `crates/domain` — Rust invoice, fulfillment, webhook, and auth state machines
- `crates/storage` — Rust database layer and migrations
- `crates/indexer` — Rust chain-event projector and finality / reorg handler
- `crates/fulfillment` — Rust digital-goods / card-code release worker
- `crates/shared` — shared DTOs, typed ids, API payloads, and non-chain domain enums
- `generated/contracts/abi` — exported ABIs from Hardhat
- `generated/contracts/addresses` — environment manifests such as `sepolia.json`
- `generated/clients/ts` — typed contract clients for `apps/web`
- `generated/clients/rust` — typed bindings / parsed event types consumed by `crates/indexer`
- `docs/runbooks` — operator runbooks, demo scripts, environment bootstrap

Deployment environments:
- `local-mock` — Hardhat mock FHE flow for contract and frontend iteration
- `sepolia-demo` — Zama Sepolia demo target with relayer-backed encrypted inputs and decrypts

## Reference Reuse Map

- `refs/epusdt/wiki/API.md`
  Reuse: hosted checkout shape, order creation response contract, callback semantics.
  Do not reuse: public-chain amount-difference matching and wallet-polling payment detection.
- `refs/epusdt/src/mq/worker.go`
  Reuse: callback retry, ack handling, idempotent delivery worker shape.
  Do not reuse: payment truth mutation from backend workers.
- `refs/epusdt/sql/v0.0.1.sql`
  Reuse: separation between payment status and callback confirmation concerns.
  Do not reuse: simplified single-table order truth model.
- `refs/zama/fhevm-skill/SKILL.md`
  Reuse: encrypted input flow, ACL propagation, async decrypt callback pattern, anti-pattern checklist.
- `refs/zama/fhevm-skill/templates/ConfidentialERC20.sol`
  Reuse: confidential token / balance handling patterns if `ConfidentialUSDMock` needs ERC-style semantics.
- `refs/zama/zama-tutorial-cn/examples/private-voting/hardhat.config.ts`
  Reuse: Hardhat + FHEVM plugin project setup and mock/testnet toggling.
- `refs/zama/zama-tutorial-cn/examples/private-voting/test/PrivateVoting.ts`
  Reuse: local mock tests with encrypted input and user decryption assertions.
- `refs/zama/relayer-sdk`
  Reuse: browser/client relayer initialization and decrypt path wiring.
  Do not reuse blindly: any outdated API surface without reconciling against current official docs during execution.

Implementation guardrails from `refs/zama/fhevm-skill/SKILL.md` that must survive into code and tests:
- ACL re-grant behavior must be explicit and verified
- decrypt pending guards must prevent duplicate active requests
- gateway-only decrypt callback protection must be enforced

## Canonical Ownership Table

| Field / status | Owner | Notes |
|---|---|---|
| `merchant_id` | Contract | Merchant identity and authorized payout wallet live on-chain in `MerchantRegistry`. Rust caches projection only. |
| `invoice_id` | Contract | Deterministic on-chain invoice identifier is the settlement anchor; Rust stores the same id as foreign key. |
| `encrypted_amount` | Contract | Stored and evaluated in confidential settlement flow; never re-authored by Rust. |
| `expiry` | Contract | Canonical payment expiry used for settlement acceptance/rejection. |
| `payment_truth` | Contract | Canonical statuses: `draft`, `pending_payment`, `paid`, `expired`, `failed`. Rust projects them from indexed events and never invents extra payment states. |
| `finality_status` | Rust projection | Operational statuses: `not_paid`, `indexing`, `awaiting_finality`, `finality_safe`, `reorg_exception`. This never overwrites canonical `payment_truth`. |
| `paid_at` | Contract event / Rust projection | Contract event is source; Rust stores indexed timestamp and block metadata for queries. |
| `decrypt_job_status` | Rust projection + relayer callbacks | Operational statuses: `idle`, `requested`, `pending_callback`, `completed`, `failed_timeout`, `failed_replay_guard`. Separate from payment truth. |
| `settlement_summary_plaintext` | Merchant wallet decrypt artifact | Produced only through wallet-authorized async decrypt; not persisted as canonical backend state. |
| `fulfillment_status` | Rust | Off-chain operational truth for digital-goods release: `unfulfilled`, `fulfilling`, `fulfilled`, `fulfillment_failed`. |
| Dashboard/UI rollups | Derived UI | Derived from Rust read models and wallet-authorized decrypt results. |

## Auth And Operator Boundary

- `merchant` auth domain: wallet nonce + signature handled by Rust session service.
- `buyer` auth domain: wallet connection only for checkout and relayer interaction; no persistent dashboard session required in MVP.
- `operator` auth domain: separate local/env-gated diagnostics surface for demo operators.
- Operator access must not reuse merchant session cookies or merchant wallet identity.

## Artifact And Codegen Authority

- ABI, event signatures, and deployed addresses are authoritative only under:
  - `generated/contracts/abi`
  - `generated/contracts/addresses`
  - `generated/clients/ts`
  - `generated/clients/rust`
- `crates/shared` may define API DTOs, typed ids, and non-chain enums only.
- `crates/shared` must not redefine ABI-derived event payload schemas.
- Contract changes require regenerating typed clients before frontend or indexer work continues.

## Invoice Creation And Checkout Authority

Creation flow:
1. Merchant signs in through wallet nonce flow handled by Rust session service.
2. Merchant submits invoice draft metadata to Rust: product label, fulfillment template, expiry, optional public description.
3. Rust creates a provisional local record with `draft_local` status and idempotency key.
4. Rust submits the canonical invoice-create transaction to `ConfidentialInvoiceSettlement`.
5. Contract emits the invoice-created event with the canonical `invoice_id`.
6. Indexer projects the event into Rust storage and flips the record to `pending_payment`.
7. Hosted checkout URL resolves by canonical `invoice_id`; if the invoice is not yet indexed, checkout stays in `provisioning` and does not allow payment submission.

Authority rule:
- Checkout, payment, expiry, and paid timestamps always key off the indexed contract invoice.
- Rust may stage drafts, but no buyer-facing payable checkout exists before the invoice is indexed from chain.

## Payment Confirmation And Fulfillment Trigger Rules

- Canonical `paid` transition: the `InvoicePaid` contract event.
- Indexer sets `finality_status=indexing` immediately after event ingestion, while `payment_truth=paid` remains the canonical contract-derived truth.
- Fulfillment unlock threshold: `payment_truth=paid` plus `finality_status=finality_safe` after configured finality depth on Zama Sepolia.
- Reorg handling before threshold: if a previously indexed paid event disappears before finality, Rust rolls `payment_truth` projection back to the last canonical contract-derived state and sets `finality_status=not_paid`.
- Deep reorg after threshold: Rust sets `finality_status=reorg_exception`, freezes automatic fulfillment retries, and requires operator intervention via runbook.
- Idempotency key: `{invoice_id}:{payment_tx_hash}:{log_index}` for payment ingestion, `{invoice_id}:{fulfillment_attempt}` for off-chain fulfillment jobs.
- Decrypt is never a prerequisite for `payment_truth=paid`.
- Only one active decrypt job may exist per invoice / merchant summary handle.
- Replayed decrypt callbacks must be ignored idempotently.
- Contract decrypt callbacks must be protected by the gateway-only callback rule.
- Merchant dashboard shows three operational states:
  - `Paid, indexing`
  - `Paid, awaiting finality`
  - `Paid, fulfillment ready`
  - `Paid, reorg exception`
- Fulfillment worker only runs on `payment_truth=paid` and `finality_status=finality_safe`.

## Phased Plan

### Phase 1 — Frontend shell + login first

Deliverables:
- Next.js 16.2 App Router app with public homepage, merchant landing, buyer checkout shell
- Wallet-first login with signed nonce and Rust session issuance
- Protected merchant dashboard shell
- Design language derived from Cryptomus / Infini / AllScale / PayTheFly: hosted checkout, invoice list, payout summary, status-centric merchant UX

Acceptance criteria:
- Merchant can connect wallet, sign in, and reach a protected dashboard
- Buyer can open a hosted checkout URL for a seeded invoice
- Rust backend is the only session authority
- No payment logic is implemented in frontend route handlers

Proof:
- Command: `cargo test -p api auth_nonce_session`
- Command: `npm --prefix apps/web run test:e2e -- auth-login.spec.ts`
- UI evidence: wallet signature completes, session cookie is issued, `/dashboard` loads, direct unauthenticated access redirects to login
- Failure signal: dashboard reachable without session, or frontend route mutates merchant/payment state directly

### Phase 2 — Confidential payment core

Deliverables:
- Rust workspace: `api`, `domain`, `storage`, `indexer`, `fulfillment`
- Contracts:
  - `MerchantRegistry`
  - `ConfidentialUSDMock`
  - `ConfidentialInvoiceSettlement`
- Shared contract artifact layer:
  - ABI bundle
  - deployed address manifest per environment
  - typed clients / codegen consumed by Rust indexer and Next.js checkout
- Payment truth state machine: `draft -> pending_payment -> paid | expired | failed`
- Finality status state machine: `not_paid -> indexing -> awaiting_finality -> finality_safe | reorg_exception`
- Fulfillment state machine: `unfulfilled -> fulfilling -> fulfilled | fulfillment_failed`
- Zama relayer integration for encrypted input and merchant-authorized decrypt views
- Contract-event indexer and signed merchant webhooks
- Merchant confidential view mode:
  - wallet-authorized async decrypt for merchant-owned settlement summaries
  - backend/operator surfaces only project indexed status, not confidential plaintext amounts
- Operator diagnostics remain on a separate auth boundary from merchant dashboard

Execution subsequence:
1. contracts + deploy scripts
2. ABI / address export + TS/Rust codegen
3. frontend checkout and backend indexer consume generated artifacts
4. indexer payment projection + finality gate
5. webhook delivery and fulfillment worker
6. merchant decrypt view and decrypt-job diagnostics

Acceptance criteria:
- Buyer can submit a real encrypted payment on Zama Sepolia
- Contract emits settlement events consumed by Rust indexer
- Merchant dashboard can view `payment_truth=paid` plus finality progress without waiting on decrypt completion
- Merchant wallet can request and view authorized confidential settlement summary through async decrypt flow
- Webhook retries are persisted and replayable
- Reorg-safe projection, deep-reorg exception handling, and finality gating are exercised in integration tests before fulfillment is enabled

Proof:
- Command: `npm --prefix contracts run test`
- Command: `cargo test -p indexer settlement_projection`
- Command: `cargo test -p fulfillment finality_gate`
- Command: `cargo test -p indexer deep_reorg_exception`
- Expected chain evidence: `InvoiceCreated` then `InvoicePaid` with stable `invoice_id`
- Expected backend evidence: indexer logs `payment_truth=paid finality_status=indexing` then `finality_status=finality_safe`
- Expected UI evidence: checkout moves `Pending -> Paid, awaiting finality -> Paid, fulfillment ready`
- Failure signal: decrypt success is required before paid appears, reorged event still triggers fulfillment, or operator auth can be reached through merchant session

### Phase 3 — Testnet demo with real merchant example

Deliverables:
- Demo merchant selling digital goods / virtual card code bundle
- Seed scripts for merchant, buyer, token funding, invoice creation
- End-to-end runbook and operator diagnostics page
- Merchant fulfillment service that releases a real artifact only after finality-safe paid state and records fulfillment separately

Acceptance criteria:
- Fresh environment can run homepage -> login -> create invoice -> buyer pays -> order fulfills
- Fulfillment artifact is released only after finality-gated paid state
- Demo can be replayed on Zama Sepolia with documented steps and expected timings
- Failure states have operator-visible diagnostics

Proof:
- Runbook command set in `docs/runbooks/sepolia-demo.md` bootstraps merchant, buyer, token funding, invoice creation, and checkout
- Expected operator evidence: tx hash, invoice id, finality depth reached, fulfillment job id, artifact release audit log
- Expected merchant evidence: dashboard shows paid invoice and fulfillment completion
- Failure drill: expired invoice, failed webhook, and reverted/reorged payment each leave visible diagnostics instead of silent hangs

## Pre-mortem

1. Zama becomes cosmetic.
   Symptom: invoice status is real, but amounts/settlement are plain backend fields.
   Guardrail: encrypted amount and merchant net settlement must originate from contract flow.

2. Demo collapses under integration timing.
   Symptom: login, relayer, indexer, and webhook pieces work alone but not as a chain.
   Guardrail: Phase 2 must include replayable event ingestion, timeout-aware status surfaces, and decrypt flow decoupled from paid confirmation.

3. Scope drifts into generic payment gateway.
   Symptom: multi-chain listeners, fiat ramps, and broad merchant features delay the first paid order.
   Guardrail: one chain, one token, one merchant fulfillment loop until the demo is stable.

## Expanded Test Plan

### Unit
- Rust domain state transitions, webhook retry policy, auth nonce/session validation
- Contract math, ACL propagation, expiry rules, duplicate-payment rejection
- Next.js auth guards, invoice rendering states, merchant dashboard presenters

### Integration
- Rust API + Postgres migrations + session issuance
- Hardhat contract deploy + Rust indexer event ingestion
- Relayer encrypted-input flow and merchant-authorized decrypt path
- Webhook delivery with retry and idempotency
- Reorg fixture: replay event removal / cursor rollback against indexer projection
- Finality fixture: delayed fulfillment until confirmation threshold is met

### E2E
- Merchant login and dashboard access
- Merchant creates invoice and copies hosted checkout link
- Buyer wallet connects, submits confidential payment, waits for paid confirmation
- Merchant sees paid order and downstream digital-goods fulfillment
- Expired invoice and failed webhook recovery scenarios
- Merchant decrypts confidential settlement summary after payment settles
- Reorg simulation proves fulfillment stays blocked until finality

### Observability
- Structured logs for auth, contract tx hash, indexer cursor, decrypt request, webhook attempts
- Metrics for invoice state counts, indexing lag, webhook retry counts, fulfillment latency
- Admin diagnostics page for chain sync, relayer health, pending decrypt jobs, failed webhooks
- Named alerts / health checks for: `indexer_stalled`, `pending_finality_backlog`, `decrypt_callback_timeout`, `webhook_dead_letter`
