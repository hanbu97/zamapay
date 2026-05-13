# Implementation Status Audit

## Objective

Finish the ZamaPay hackathon demo around one clean confidential rail: project creation, CardForge checkout, private payment proof, Growth subscription fee change, dashboard stats, and merchant-signed private withdraw projection.

Sepolia is the public-testnet target. FHE encrypted inputs and public decrypts must use Zama's official test relayer through `@zama-fhe/relayer-sdk` `SepoliaConfig`, not a ZamaPay platform relayer and not Hardhat mock RPC.

## Current Scope

| Area | Active artifact | Current position |
| --- | --- | --- |
| Rust API | `crates/api`, `crates/storage`, `crates/shared` | Axum API with normalized Postgres-backed portal state, contract environment manifests, session auth, project checkout, billing, and withdraw records. |
| Web console | `apps/web/app`, `apps/web/components` | Next.js merchant console, projects, billing, hosted checkout, docs, and local wallet connection surfaces. |
| Private checkout | `contracts/contracts/PrivateCheckoutSettlement.sol` | Stores commitments and encrypted handles; public finalization reveals only accepted/rejected. |
| Mock cUSDT token | `contracts/contracts/ConfidentialUSDMock.sol` | Official-style mintable confidential token mock for subscription charges, buyer faucet claims, and checkout debits; not a MetaMask ERC20 token. |
| Growth subscription | `contracts/contracts/PrivateSubscriptionRegistry.sol`, `apps/web/components/merchant/MerchantBillingPanel.tsx`, `apps/web/app/api/billing/project-growth/route.ts` | Browser wallet pays encrypted cUSDT to the subscription registry; local-dev can server-finalize, while Sepolia browser finalizes with Zama official public-decrypt proof before the API projects chain evidence. |
| CardForge demo | `demo/cardforge` | Standalone merchant demo configured from ZamaPay project API values. |

## Removed Paths

| Removed path | Reason |
| --- | --- |
| Transparent invoice settlement fallback | It exposed merchant, payout, payer, and amount fields publicly, which conflicts with the private checkout claim. |
| ZamaPay platform relayer | MVP uses wallet-submitted checkout/subscription transactions, local-dev-only shims where needed, and Zama official relayer/gateway surfaces for Sepolia FHE operations. |
| Old local invoice smoke/projection scripts | They exercised the removed transparent invoice rail rather than the private checkout rail. |

## Required Evidence Before Claiming Complete

| Requirement | Evidence command |
| --- | --- |
| Contracts, web tests, and Rust workspace checks pass | `just check` |
| Web production build compiles | `just build-web` |
| Generated clients contain the selected contract manifest | `just reset-local` after `just contracts-node` |
| Live local app readiness | `just verify-local` after Hardhat, Rust API, and Next web are running |

## Current Risks

- Local-dev browser E2E still depends on running Hardhat, Rust API, Next web, CardForge, and Firefox wallet state.
- Withdraw is a merchant-signed local-dev on-chain operation, but payout-recipient privacy is still out of scope.
- The mock confidential rail proves encrypted amount validation and demo debit. Direct-wallet MVP does not hide the buyer transaction sender.
