# Mermer Pay PRD

Last updated: 2026-05-06
Status: Approved for implementation
Mode: RALPLAN

## 1. Product

Mermer Pay is a confidential merchant payments platform built around Zama FHEVM.

The product demo closes one full loop:
- merchant signs in with wallet
- merchant creates hosted checkout invoice
- buyer pays with confidential token on Zama Sepolia
- Rust backend indexes finality-safe settlement events
- merchant dashboard shows paid state
- digital-good fulfillment releases a real artifact after payment finality

## 2. Why This Exists

Existing crypto payment gateways optimize settlement speed, but expose merchant revenue, buyer amounts, and operational patterns.

Mermer Pay uses Zama so that:
- invoice amount submission is encrypted at the point of payment
- merchant settlement views require wallet-authorized decrypt access
- backend operators can run status, webhook, and fulfillment operations without becoming the plaintext source of truth

## 3. Users

### Merchant
- creates invoices
- shares hosted checkout links
- monitors order and fulfillment status
- decrypts own settlement views

### Buyer
- opens hosted checkout
- connects wallet
- submits confidential payment

### Operator
- monitors chain sync, relayer health, webhook retries, and fulfillment failures
- does not own confidential plaintext settlement data
- uses a separate operator-only auth boundary in demo mode

## 4. Goals

### G1. Build a real confidential payment flow
- Zama encrypted input is required for payment submission
- settlement truth is on-chain
- merchant plaintext settlement summary comes from ACL + decrypt flow

### G2. Build a merchant-quality product shell
- polished homepage
- merchant dashboard
- hosted checkout
- admin diagnostics

### G3. Build a replayable demo
- one merchant
- one buyer
- one token
- one digital-goods fulfillment example
- one testnet runbook

## 5. Non-goals

Not in MVP:
- multi-chain deposit listeners
- fiat rails
- card acquiring
- KYC/KYB workflows
- multi-tenant organization model beyond one demo merchant
- generalized physical logistics
- loyalty, coupon, or subscription systems

## 6. Product Scope

### 6.1 Homepage
- landing page that explains confidential merchant checkout
- sections for merchant value, buyer flow, platform trust model, and live product entry
- direct actions: `Connect wallet`, `View demo checkout`, `Merchant dashboard`

### 6.2 Login
- wallet-first sign-in
- Rust issues nonce and validates signature
- Rust mints the session cookie
- frontend does not become auth authority

### 6.3 Merchant dashboard
- invoice list
- invoice detail
- payout and settlement summary section
- confidential summary decrypt action
- fulfillment state timeline
- payment truth and finality progress separated in UI

### 6.4 Operator diagnostics
- local/env-gated operator page
- chain sync status
- finality backlog
- decrypt job queue and timeout states
- webhook dead-letter and fulfillment failure views
- not reachable through merchant session alone

### 6.5 Hosted checkout
- buyer invoice page
- amount, merchant label, expiry, product note
- wallet connect
- encrypted payment submission
- status progression:
  - pending
  - paid awaiting finality
  - fulfillment ready
  - fulfilled

### 6.6 Fulfillment demo
- merchant sells a digital good / card-code bundle
- fulfillment worker releases a real artifact only after finality-safe paid state
- audit log records artifact release

## 7. System Boundaries

### On-chain
- `MerchantRegistry`
- `ConfidentialUSDMock`
- `ConfidentialInvoiceSettlement`

Owns:
- merchant registry truth
- canonical invoice ids
- encrypted payment amount handles
- canonical payment truth

### Rust backend
- auth nonce/session
- chain indexing and projection
- webhook retries
- fulfillment workflow
- admin diagnostics

Owns:
- read models
- finality projection
- decrypt job projection
- fulfillment truth
- operator workflows

### Next.js frontend
- homepage
- login
- merchant dashboard
- buyer checkout

Owns:
- product UX
- client relayer wiring
- wallet-driven decrypt requests

## 8. Technical Decisions

### D1. Frontend
- Next.js 16 App Router
- TypeScript
- latest React supported by current Next.js 16 docs

Reason:
- current official direction
- clean split between public pages, protected dashboard, and buyer checkout

### D2. Backend
- Rust workspace split by responsibility
- API, domain, storage, indexer, fulfillment, shared crates

Reason:
- preserves one source of truth per concern
- keeps indexer and fulfillment isolated from HTTP concerns

### D3. Zama integration
- use official relayer SDK flow for encrypted inputs
- use ACL for merchant decrypt permissions
- use async decrypt instead of treating decrypt as synchronous gating
- enforce gateway-only decrypt callback protection and single active decrypt job per handle

Reason:
- matches current protocol model
- prevents fake "privacy" architecture

### D4. Payment rail
- one rail only in MVP: Zama Sepolia

Reason:
- removes reconciliation complexity
- keeps demo deterministic

## 9. Success Criteria

The project is successful only if all are true:

1. Merchant can sign in and create a payable invoice.
2. Buyer can pay the invoice with confidential input on Zama Sepolia.
3. Rust indexer projects payment status from chain events.
4. Merchant sees canonical paid status and separate finality progress before decrypt completes.
5. Merchant can decrypt own settlement summary through authorized flow.
6. Fulfillment runs only after finality threshold.
7. Deep reorg after threshold is surfaced as operator intervention, not silent rollback.
8. Demo runbook reproduces the full loop on a fresh environment.

## 10. Delivery Phases

### Phase 1 — Shell and auth
- homepage
- login
- dashboard shell
- seeded checkout shell
- auth tests

Exit:
- login works end to end
- dashboard is protected
- checkout link renders from seeded data

### Phase 2 — Confidential payment core
- contracts
- address manifest and typed codegen
- relayer integration
- chain indexer
- payment truth and finality projection
- webhook and fulfillment gate
- merchant decrypt flow
- operator diagnostics

Exit:
- confidential payment works on Zama Sepolia
- status moves from payment to finality-safe ready state
- deep reorg enters operator-visible exception path

### Phase 3 — Demo merchant fulfillment
- digital-goods merchant example
- seed scripts
- runbook
- diagnostics page
- failure drills

Exit:
- real artifact is released only after finality-safe paid state
- demo replay is documented and stable

## 11. Risks And Guardrails

### R1. Zama reduced to garnish
Guardrail:
- encrypted amount and merchant settlement view must originate in contract flow

### R2. Backend becomes duplicate source of truth
Guardrail:
- backend projects contract events, but never authors payment truth

### R3. Demo blocked by decrypt timing
Guardrail:
- paid state depends on chain events and finality, not merchant decrypt completion

### R4. Deep reorg after fulfillment creates irreversible artifact mismatch
Guardrail:
- treat deep reorg after threshold as `reorg_exception` with manual intervention runbook, not as an automatic rollback path

### R5. Scope explosion
Guardrail:
- no second payment rail before first rail is stable

## 12. Reference Use

### Reuse from `refs/epusdt`
- hosted checkout shape
- order status semantics
- callback retry patterns
- admin troubleshooting surfaces

### Reuse from `refs/zama`
- Hardhat + FHEVM setup
- encrypted input flow
- ACL patterns
- relayer initialization
- mock/testnet testing approach
- decrypt pending / callback guardrails from `fhevm-skill`

### Do not reuse
- public-chain wallet polling as payment truth
- amount-difference matching logic
- any relayer SDK surface that conflicts with current official docs

## 13. Execution Order

1. scaffold workspace
2. ship homepage + auth + dashboard shell
3. verify login
4. implement contracts + typed artifacts
5. wire frontend encrypted payment flow against generated clients
6. implement Rust indexer and finality gates against generated bindings
7. implement webhook and fulfillment gate
8. implement merchant decrypt views
9. implement operator diagnostics and reorg-exception handling
10. implement digital-goods fulfillment demo
11. run local mock verification
12. run Zama Sepolia demo verification
