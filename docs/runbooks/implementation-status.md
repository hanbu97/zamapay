# Implementation Status Audit

## Objective

Finish the Mermer Pay hackathon demo around one clean local-dev rail: project creation, CardForge checkout, local private payment proof, Growth subscription fee change, dashboard stats, and withdraw read model.

Public testnets are intentionally out of scope for the current build. Sepolia should be added later through Zama official relayer/gateway surfaces for FHE operations, not through a Mermer Pay platform relayer.

## Current Scope

| Area | Active artifact | Current position |
| --- | --- | --- |
| Rust API | `crates/api`, `crates/storage`, `crates/shared` | Axum API with normalized Postgres-backed portal state, local-dev contract manifest, session auth, project checkout, billing, and withdraw records. |
| Web console | `apps/web/app`, `apps/web/components` | Next.js merchant console, projects, billing, hosted checkout, docs, and local wallet connection surfaces. |
| Private checkout | `contracts/contracts/PrivateCheckoutSettlement.sol` | Stores commitments and encrypted handles; public finalization reveals only accepted/rejected. |
| Mock cUSDT token | `contracts/contracts/ConfidentialUSDMock.sol` | Official-style mintable confidential token mock for subscription charges, buyer faucet claims, and checkout debits; not a MetaMask ERC20 token. |
| Growth subscription | `contracts/contracts/PrivateSubscriptionRegistry.sol`, `apps/web/components/merchant/MerchantBillingPanel.tsx`, `apps/web/app/api/dev/project-local-growth/route.ts` | Browser wallet pays encrypted cUSDT to the subscription registry; the API route only projects finalized chain evidence for new checkout fee snapshots. |
| CardForge demo | `demo/cardforge` | Standalone merchant demo configured from Mermer Pay project API values. |

## Removed Paths

| Removed path | Reason |
| --- | --- |
| Transparent invoice settlement fallback | It exposed merchant, payout, payer, and amount fields publicly, which conflicts with the private checkout claim. |
| Public-testnet manifests, scripts, and web branches | Public network runs require protocol-fee and relayer funding design; keeping them active made local testing ambiguous. |
| Mermer Pay platform relayer | MVP uses direct buyer wallet submission on local-dev; future Sepolia should use Zama official relayer/gateway surfaces for FHE operations. |
| Old local invoice smoke/projection scripts | They exercised the removed transparent invoice rail rather than the private checkout rail. |

## Required Evidence Before Claiming Complete

| Requirement | Evidence command |
| --- | --- |
| Contracts compile and private checkout tests pass | `npm --workspace contracts run test` |
| Generated clients contain only local-dev active contracts | `npm --workspace contracts run sync:generated` |
| Web local-only environment and checkout compile | `npm --workspace apps/web run lint` and `npm --workspace apps/web run test` |
| Rust local-only DTO/API/storage compile | `cargo fmt --all --check` and `cargo check --workspace` |
| Live local app readiness | `npm run verify:local` after Hardhat, Rust API, and Next web are running |

## Current Risks

- Local-dev browser E2E still depends on running Hardhat, Rust API, Next web, CardForge, and Firefox wallet state.
- Withdraw is currently a portal read-model operation, not a private on-chain settlement close.
- The mock confidential rail proves encrypted amount validation and demo debit. Direct-wallet MVP does not hide the buyer transaction sender.
