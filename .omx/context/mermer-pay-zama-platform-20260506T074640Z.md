## Task Statement

Plan and then implement `Mermer Pay`, a confidential merchant payment platform built in this workspace with a Rust backend and the latest Next.js frontend. The delivery should start with homepage + auth/login + Zama integration basics, then build the payment platform, then prove it with an end-to-end demo using a real card-issuing / payment-consuming example on testnet.

## Desired Outcome

- A consensus implementation plan that is detailed enough to hand off to execution without rediscovery.
- Clear architecture for Rust services, Next.js app, Zama/FHEVM contracts, relayer integration, and demo flow.
- Explicit sequencing for:
  1. frontend shell and auth
  2. confidential payment core
  3. dashboard / merchant UX
  4. testnet deployment
  5. real demo integration

## Known Facts / Evidence

- Workspace currently contains references only; there is no first-party app scaffold yet.
- `refs/epusdt` contains a working traditional crypto payment gateway skeleton:
  order creation, wallet-address allocation, amount reservation, chain listeners, callbacks, admin console.
- `refs/zama/fhevm-skill` contains FHEVM project setup guidance, contract templates, ACL patterns, input-proof handling, and relayer integration notes.
- `refs/zama/zama-tutorial-cn/examples/private-voting` contains a runnable Hardhat + frontend reference with mock tests and deploy flow.
- Official Zama docs confirm the current stack shape:
  FHEVM Solidity guides, relayer SDK, encrypted types, ACL, frontend encryption/decryption, and Sepolia relayer setup.
- Official Next.js docs show the latest App Router docs and authentication guidance under the current docs surface.
- External product references point to the expected merchant-product surface:
  Cryptomus focuses on invoices, white-label checkout, status APIs, fiat-denominated invoicing, and auto-conversion.
  Infini exposes merchant API/backend, order status, settlement/withdrawal, and webhooks.
  AllScale adds invoicing, payroll, balance dashboard, social-commerce profile, and compliance framing.
  PayTheFly emphasizes one-tap checkout and hosted payment-link ergonomics.

## Constraints

- Backend must be Rust.
- Frontend must use the latest Next.js generation, meaning App Router and current official auth guidance.
- Zama usage must be real, not decorative. The plan must produce a confidential payment system, not only a public crypto gateway skin.
- The product must be demonstrable with an end-to-end testnet scenario.
- The final demo should include a realistic downstream merchant use case, ideally a card / license / digital goods flow.
- No broad dependency sprawl without need.
- This is both a hackathon project and a seed for a possibly investable merchant product.

## Unknowns / Open Questions

- What exact auth primitive should be treated as the first shipping login:
  wallet auth only, wallet + magic email, or email session plus wallet connect for payment ops?
- What exact Zama-confidential value proposition should be the MVP core:
  confidential invoice amount, confidential merchant revenue ledger, confidential payer identity metadata, or confidential settlement splits?
- Should the first working chain target be Zama Sepolia only, or a hybrid where the app mirrors some public-chain payment semantics while the confidential ledger lives on Zama Sepolia?
- How much of the `epusdt` model should be reused conceptually versus replaced by contract-native invoice settlement?
- Which card platform example is the most practical demo target in the available time window?

## Likely Codebase Touchpoints

- New app scaffold under the workspace root for frontend, backend, contracts, and docs.
- `refs/epusdt/src/...` for payment gateway lifecycle reference.
- `refs/zama/fhevm-skill/SKILL.md`
- `refs/zama/fhevm-skill/templates/*`
- `refs/zama/fhevm/README.md`
- `refs/zama/relayer-sdk/*`
- `refs/zama/zama-tutorial-cn/examples/private-voting/*`

## Planning Risks

- Scope explosion: trying to build both a full gateway and a full confidential finance layer in one pass.
- False Zama integration: adding wallet login and a public payment flow while leaving the actual sensitive merchant state public.
- Demo fragility: frontend, relayer, contracts, and testnet funding may all be individually correct but fail as a single runbook.
