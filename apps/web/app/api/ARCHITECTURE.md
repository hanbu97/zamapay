# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts
|-- checkout/project-finalized-payment/route.ts
`-- dev/
    |-- sign-message/route.ts
    |-- project-local-growth/route.ts
    `-- local-chain-invoice/route.ts
```

## Decisions

- API routes are server-only operator bridges. They may hold `MERMER_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `project-finalized-payment` either verifies a supplied `PrivatePaymentFinalized` transaction or, for local-dev hosted checkout, finalizes a submitted private payment server-side before projecting Rust payment/finality state.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser login path without a wallet extension.
- `dev/project-local-growth` accepts browser-finalized Growth chain evidence and projects the entitlement without leaking the operator key to client code. It does not sign, mint, approve, or charge cUSDT.
- `dev/local-chain-invoice` creates the local-dev `PrivateCheckoutSettlement` checkout for localhost non-production server calls and returns the zero-based checkout id; project checkout must persist this id instead of inventing a read-model-only number.
- Browser checkout code now submits only one local private payment transaction with the connected buyer wallet; finalization is a server-side local-dev bridge, not a second buyer wallet confirmation.
- Buyer-facing confidential cUSDT balance rendering belongs to the CardForge browser panel reading Hardhat/FHEVM mock RPC directly, not to a backend projection endpoint.
