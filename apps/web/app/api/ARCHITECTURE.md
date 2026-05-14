# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts
|-- auth/nonce/route.ts
|-- auth/verify/route.ts
|-- billing/[...path]/route.ts
|-- billing/project-growth/route.ts
|-- checkout/project-finalized-payment/route.ts
|-- dev/
|   |-- local-session/route.ts
|   |-- local-evm-withdraw/route.ts
|   |-- local-private-withdraw/route.ts
|   |-- local-chain-invoice/route.ts
|   |-- project-local-growth/route.ts
|   `-- sign-message/route.ts
`-- projects/[[...path]]/route.ts
```

## Decisions

- API routes are server-only operator bridges. They may hold `ZAMAPAY_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `auth/nonce` and `auth/verify` keep wallet login same-origin so the browser session cookie belongs to the web host.
- `billing/[...path]` and `projects/[[...path]]` proxy browser dashboard traffic to Rust with the same-origin cookie, while server components may still call Rust directly.
- `billing/project-growth` verifies a `SubscriptionChangeFinalized` transaction from the configured manifest, then projects Growth entitlement into Rust without browser access to the operator key.
- `project-finalized-payment` verifies a supplied `PrivatePaymentFinalized` transaction on the configured manifest or, for local-dev hosted checkout, finalizes a submitted private payment server-side; it returns after paid projection and lets finality/webhook projection continue in the background.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `ZAMAPAY_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser login path without a wallet extension.
- `dev/local-session` uses the same local signer gate to mint a same-origin merchant session for browser QA when wallet UI automation is unavailable.
- `dev/local-evm-withdraw` signs the local settlement-contract withdraw authorization and returns withdrawal transaction evidence for browser QA of the ordinary EVM rail.
- `dev/project-local-growth` accepts the browser-submitted Growth request transaction, server-finalizes the publicly decrypted boolean, and projects the entitlement without leaking the operator key to client code.
- `dev/local-chain-invoice` creates the environment-selected `PrivateCheckoutSettlement` checkout for localhost non-production server calls: local-dev uses Hardhat/FHEVM mock encryption, Sepolia uses Zama's official test relayer plus the checkout-creator signer; project checkout must persist that chain evidence.
- `dev/local-private-withdraw` is the local-dev submitter shim: it accepts a merchant EIP-712 authorization plus encrypted withdraw input bound to the Hardhat submitter signer, submits the contract call, and returns only chain evidence.
- Browser checkout code now submits only one local private payment transaction with the connected buyer wallet; finalization is a server-side local-dev bridge, not a second buyer wallet confirmation.
- Buyer-facing confidential cUSDT balance rendering belongs to the CardForge browser panel reading Hardhat/FHEVM mock RPC directly, not to a backend projection endpoint.
