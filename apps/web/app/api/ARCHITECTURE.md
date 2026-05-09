# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts                       # Same-origin session-cookie clear fallback for dashboard logout
|-- checkout/project-finalized-payment/route.ts # Verifies private/legacy paid tx events and bridges projection into Rust
`-- dev/
    |-- sign-message/route.ts                  # Local-only browser login verifier signer
    |-- project-local-growth/route.ts          # Dev-only Growth entitlement projection for browser QA
    |-- local-chain-invoice/route.ts           # Dev-only bridge that creates the real local private checkout before hosted checkout
    |-- local-private-checkout/pay/route.ts    # Dev-only buyer intent verifier and relayer submission bridge
    |-- local-confidential-wallet/route.ts     # Dev-only confidential balance projection and local funding faucet
    `-- local-confidential-payment/
        |-- inputs/route.ts                    # Dev-only local FHEVM encrypted approval/payment input bridge
        `-- decrypt/route.ts                   # Dev-only local FHEVM public boolean decrypt bridge
```

## Decisions

- API routes are server-only operator bridges. They may hold `MERMER_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `project-finalized-payment` accepts a transaction hash, verifies `PrivatePaymentFinalized` from `PrivateCheckoutSettlement` or legacy `InvoicePaid`, then calls Rust projection and confirmation endpoints.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser `LoginCard` path without a wallet extension.
- `dev/project-local-growth` executes the local chain private Growth upgrade and projects the resulting entitlement proof without leaking the operator key to client code.
- `dev/local-chain-invoice` creates the local-dev `PrivateCheckoutSettlement` checkout and returns the zero-based checkout id; project checkout must persist this id instead of inventing a read-model-only number.
- `dev/local-private-checkout/pay` verifies the buyer's signed payment intent, checks the app-rendered confidential rail, relays encrypted payment submission, decrypts only `accepted`, and finalizes on chain.
- `dev/local-confidential-wallet` uses the same gate to render a local confidential cUSDT balance from `MockConfidentialPaymentRail`; it is a development projection/faucet, not a public ERC20 token listing.
- `dev/local-confidential-payment/inputs` is a 410 compatibility tombstone so old approval/payInvoice callers do not silently use the wrong rail.
- `dev/local-confidential-payment/decrypt` remains only as a low-level local boolean decrypt helper; the private checkout route owns the normal browser payment path.
- The CLI projection script remains the fallback, but hosted checkout can now complete encrypted local settlement and read-model handoff without exposing operator credentials.
