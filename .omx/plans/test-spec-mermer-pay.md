# Mermer Pay Test Spec

Last updated: 2026-05-06
Status: Approved for implementation
Mode: RALPLAN

## 1. Test Objective

Prove that Mermer Pay is a real confidential payments system, not a styled mockup with a private-looking badge.

The test plan must prove:
- auth is real
- payment truth comes from contracts
- merchant confidentiality depends on Zama ACL/decrypt flow
- fulfillment respects finality and reorg handling

## 2. Evidence Standard

Every acceptance item needs one of:
- automated test
- deterministic CLI command with expected output
- UI proof with explicit visible state
- log proof with expected event names

Claims without one of these are incomplete.

## 3. Environments

### Local mock
Purpose:
- fast iteration for contracts, frontend states, and Rust state machines

Must support:
- encrypted input tests
- mock decrypt flow
- projection tests
- fulfillment gating tests

### Zama Sepolia demo
Purpose:
- end-to-end validation with real relayer-backed encrypted inputs

Must support:
- merchant wallet login
- buyer confidential payment
- finality-safe projection
- merchant decrypt request
- real fulfillment demo

## 4. Phase 1 Verification — Shell and auth

### A1. Nonce issue and wallet sign-in
Proof:
- `cargo test -p api auth_nonce_session`
- browser e2e sign-in spec

Pass when:
- nonce is single-use
- signature validation succeeds
- session cookie is issued by Rust

Fail when:
- same nonce replays
- frontend manufactures authenticated state without backend session

### A2. Protected dashboard
Proof:
- browser e2e route-guard spec

Pass when:
- anonymous access redirects to login
- authenticated access loads dashboard

Fail when:
- `/dashboard` renders without session

### A3. Hosted checkout shell
Proof:
- seeded invoice page render spec

Pass when:
- buyer route renders invoice metadata and status shell

Fail when:
- payable checkout is exposed before canonical invoice exists

## 5. Phase 2 Verification — Confidential payment core

### B1. Contract lifecycle
Proof:
- `npm --prefix contracts run test`

Pass when:
- invoice create emits `InvoiceCreated`
- valid payment emits `InvoicePaid`
- duplicate or expired payment is rejected

Fail when:
- payment can settle after expiry
- duplicate payment mutates status

### B2. Encrypted input flow
Proof:
- contract/unit tests using official relayer-compatible input format
- frontend integration test against local mock or test harness

Pass when:
- payment submission uses encrypted input path
- plaintext amount is not posted as canonical payment input

Fail when:
- backend accepts plain amount as settlement truth

### B3. ACL and merchant decrypt
Proof:
- integration test for merchant-owned decrypt request
- UI flow test for decrypt action and result render

Pass when:
- merchant can decrypt authorized settlement summary
- unauthorized wallet cannot decrypt merchant summary
- decrypt request cannot be duplicated while one is already pending
- gateway-only decrypt callback protection rejects unauthorized callback sender

Fail when:
- operator or unrelated wallet can read merchant plaintext
- replayed or spoofed decrypt callback mutates state

### B4. Indexer projection
Proof:
- `cargo test -p indexer settlement_projection`
- log snapshot test for event ingestion

Pass when:
- payment event projects to `payment_truth=paid` and `finality_status=indexing`
- finality threshold projects to `finality_status=finality_safe`

Fail when:
- backend paid state appears without chain event

### B5. Reorg handling
Proof:
- indexer integration fixture with event rollback

Pass when:
- reorg before threshold rolls projection back to last canonical contract-derived payment state
- fulfillment remains blocked

Fail when:
- reorged event still unlocks fulfillment

### B6. Deep reorg exception
Proof:
- `cargo test -p indexer deep_reorg_exception`

Pass when:
- deep reorg after threshold sets `finality_status=reorg_exception`
- automatic fulfillment retry is frozen
- operator diagnostics surface required manual action

Fail when:
- system silently rewrites history after fulfillment-safe release

### B7. Fulfillment gate
Proof:
- `cargo test -p fulfillment finality_gate`

Pass when:
- fulfillment job is enqueued only after finality-safe payment state

Fail when:
- merchant decrypt success alone can trigger fulfillment

### B8. Webhook retries
Proof:
- integration test for signed webhook delivery and retry queue

Pass when:
- retry schedule persists
- duplicate delivery stays idempotent

Fail when:
- transient webhook failure loses event permanently

### B9. Operator auth boundary
Proof:
- browser or integration test against diagnostics route

Pass when:
- merchant session cannot open operator diagnostics
- operator route requires separate env-gated credential or local-only guard

Fail when:
- merchant cookie grants operator access

## 6. Phase 3 Verification — Demo merchant

### C1. Full buyer path
Proof:
- runbook-driven browser/manual flow on Zama Sepolia

Pass when:
- buyer opens checkout
- buyer pays
- UI moves:
  - `Pending`
  - `Paid, awaiting finality`
  - `Paid, fulfillment ready`
  - `Fulfilled`

Fail when:
- state skips finality gate
- UI hangs without diagnostics

### C2. Merchant decrypt path
Proof:
- merchant dashboard action on Sepolia demo

Pass when:
- merchant requests decrypt
- dashboard renders confidential settlement summary

Fail when:
- merchant revenue is already present in backend plaintext read model

### C3. Fulfillment artifact release
Proof:
- runbook plus audit log check

Pass when:
- card code / digital artifact is released exactly once
- release is linked to invoice id and fulfillment job id

Fail when:
- artifact releases before finality
- retries release duplicate artifact

### C4. Failure drills
Proof:
- scripted scenarios for expired invoice, failed webhook, and reorg rollback

Pass when:
- operator page surfaces each failure with explicit status and next action

Fail when:
- order disappears or remains stuck without explanation

### C5. Decrypt reliability drill
Proof:
- scripted decrypt timeout / replay scenario

Pass when:
- pending decrypt is visible
- timeout is surfaced
- replay callback is ignored without corrupting state

Fail when:
- decrypt job state is ambiguous or corrupts settlement view

## 7. Observability Checks

Must capture:
- auth nonce issuance and consumption
- login session issuance
- invoice create tx hash
- payment tx hash
- indexer cursor
- finality depth progress
- decrypt request id
- decrypt pending guard trip
- decrypt callback sender
- webhook attempt count
- fulfillment job id

Must expose:
- indexer stalled
- pending finality backlog
- decrypt callback timeout
- webhook dead letter
- reorg exception queue
- operator auth rejection events

## 8. Minimal Command Matrix

### Contracts
- `npm --prefix contracts run test`

### Rust
- `cargo test -p api auth_nonce_session`
- `cargo test -p indexer settlement_projection`
- `cargo test -p fulfillment finality_gate`

### Frontend
- `npm --prefix apps/web run lint`
- `npm --prefix apps/web run test:e2e -- auth-login.spec.ts`
- `npm --prefix apps/web run test:e2e -- checkout-flow.spec.ts`

### End-to-end
- documented command set in `docs/runbooks/sepolia-demo.md`

## 9. Release Gate

Implementation is not done until all are true:

1. Phase 1 auth tests pass.
2. Contract tests pass.
3. Indexer and fulfillment integration tests pass.
4. Merchant decrypt path is verified.
5. Sepolia demo runbook is executed successfully.
6. Failure drills leave visible diagnostics.
