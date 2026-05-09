# API Route Architecture

## Tree

```text
apps/web/app/api
|-- auth/logout/route.ts                       # Same-origin session-cookie clear fallback for dashboard logout
|-- checkout/project-finalized-payment/route.ts # Verifies paid tx events plus private split handles and bridges projection into Rust
`-- dev/
    |-- sign-message/route.ts                  # Local-only browser login verifier signer
    |-- project-local-growth/route.ts          # Dev-only Growth entitlement projection for browser QA
    |-- local-chain-invoice/route.ts           # Dev-only bridge that creates the real local settlement invoice before hosted checkout
    |-- local-confidential-wallet/route.ts     # Dev-only confidential balance projection and local funding faucet
    `-- local-confidential-payment/
        |-- inputs/route.ts                    # Dev-only local FHEVM encrypted approval/payment input bridge
        `-- decrypt/route.ts                   # Dev-only local FHEVM public boolean decrypt bridge
```

## Decisions

- API routes are server-only operator bridges. They may hold `MERMER_OPERATOR_KEY`; browser components must not.
- `auth/logout` only expires the browser session cookie; Rust `DELETE /api/session` remains the authoritative server-session deletion path when the API process is current.
- `project-finalized-payment` accepts only a transaction hash, verifies the current settlement contract emitted `InvoicePaid`, reads optional private split handles, then calls Rust projection and confirmation endpoints.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser `LoginCard` path without a wallet extension.
- `dev/project-local-growth` uses the local-only gate to exercise subscription projection without leaking the operator key to client code.
- `dev/local-chain-invoice` creates the local-dev `ConfidentialInvoiceSettlement` invoice and returns the zero-based chain invoice id; project checkout must persist this id instead of inventing a read-model-only number.
- `dev/local-confidential-wallet` uses the same gate to render a local confidential cUSDT balance inside the merchant demo app; it is a development projection/faucet, not a public ERC20 token listing.
- `dev/local-confidential-payment/inputs` keeps local browser checkout on the Zama shape by producing mock encrypted approval/payment inputs for the selected wallet and refusing payment when the confidential balance is insufficient.
- `dev/local-confidential-payment/decrypt` decrypts only the local `accepted` boolean so the browser can call `finalizePayment`; per-order amounts remain encrypted in the checkout path.
- The CLI projection script remains the fallback, but hosted checkout can now complete encrypted local settlement and read-model handoff without exposing operator credentials.
