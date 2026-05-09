# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts
|-- checkout/project-finalized-payment/route.ts
`-- dev/
    |-- sign-message/route.ts
    |-- project-local-growth/route.ts
    |-- local-chain-invoice/route.ts
    |-- local-private-checkout/pay/route.ts
    `-- local-confidential-wallet/route.ts
```

## Decisions

- API routes are server-only operator bridges. They may hold `MERMER_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `project-finalized-payment` accepts a transaction hash, verifies `PrivatePaymentFinalized` from `PrivateCheckoutSettlement`, then calls Rust projection and confirmation endpoints.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser login path without a wallet extension.
- `dev/project-local-growth` executes the local chain private Growth upgrade and projects the resulting entitlement proof without leaking the operator key to client code.
- `dev/local-chain-invoice` creates the local-dev `PrivateCheckoutSettlement` checkout and returns the zero-based checkout id; project checkout must persist this id instead of inventing a read-model-only number.
- `dev/local-private-checkout/pay` verifies the buyer signed payment intent, checks the app-rendered confidential rail, relays encrypted payment submission, decrypts only `accepted`, and finalizes on chain.
- `dev/local-confidential-wallet` renders a local confidential cUSDT balance from `MockConfidentialPaymentRail`; it is a development projection/faucet, not a public ERC20 token listing.
