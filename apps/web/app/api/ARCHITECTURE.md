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
- `project-finalized-payment` accepts a transaction hash, verifies `PrivatePaymentFinalized` from `PrivateCheckoutSettlement`, then calls Rust projection and confirmation endpoints.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser login path without a wallet extension.
- `dev/project-local-growth` accepts browser-finalized Growth chain evidence and projects the entitlement without leaking the operator key to client code. It does not sign, mint, approve, or charge cUSDT.
- `dev/local-chain-invoice` creates the local-dev `PrivateCheckoutSettlement` checkout and returns the zero-based checkout id; project checkout must persist this id instead of inventing a read-model-only number.
- Browser checkout code now submits local private payment directly with the connected buyer wallet; there is no Mermer Pay platform relayer API route in the MVP.
- Buyer-facing confidential cUSDT balance rendering belongs to the CardForge browser panel reading Hardhat/FHEVM mock RPC directly, not to a backend projection endpoint.
