# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts
|-- billing/project-growth/route.ts
|-- checkout/project-finalized-payment/route.ts
`-- dev/
    |-- sign-message/route.ts
    |-- project-local-growth/route.ts
    |-- local-private-withdraw/route.ts
    `-- local-chain-invoice/route.ts
```

## Decisions

- API routes are server-only operator bridges. They may hold `ZAMAPAY_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `billing/project-growth` verifies a `SubscriptionChangeFinalized` transaction from the configured manifest, then projects Growth entitlement into Rust without browser access to the operator key.
- `project-finalized-payment` verifies a supplied `PrivatePaymentFinalized` transaction on the configured manifest or, for local-dev hosted checkout, finalizes a submitted private payment server-side before projecting Rust payment/finality state.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `ZAMAPAY_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser login path without a wallet extension.
- `dev/project-local-growth` accepts the browser-submitted Growth request transaction, server-finalizes the publicly decrypted boolean, and projects the entitlement without leaking the operator key to client code.
- `dev/local-chain-invoice` creates the environment-selected `PrivateCheckoutSettlement` checkout for localhost non-production server calls: local-dev uses Hardhat/FHEVM mock encryption, Sepolia uses Zama's official test relayer plus the checkout-creator signer; project checkout must persist that chain evidence.
- `dev/local-private-withdraw` is the local-dev submitter shim: it accepts a merchant EIP-712 authorization plus encrypted withdraw input bound to the Hardhat submitter signer, submits the contract call, and returns only chain evidence.
- Browser checkout code now submits only one local private payment transaction with the connected buyer wallet; finalization is a server-side local-dev bridge, not a second buyer wallet confirmation.
- Buyer-facing confidential cUSDT balance rendering belongs to the CardForge browser panel reading Hardhat/FHEVM mock RPC directly, not to a backend projection endpoint.
