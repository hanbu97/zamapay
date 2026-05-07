# API Route Architecture

## Tree

```text
apps/web/app/api
|-- checkout/project-finalized-payment/route.ts # Verifies InvoicePaid tx and bridges projection into Rust
`-- dev/sign-message/route.ts                  # Local-only browser login verifier signer
```

## Decisions

- API routes are server-only operator bridges. They may hold `MERMER_OPERATOR_KEY`; browser components must not.
- `project-finalized-payment` accepts only a transaction hash, verifies the current settlement contract emitted `InvoicePaid`, then calls Rust projection and confirmation endpoints.
- `dev/sign-message` delegates its environment decision to `lib/dev-signer-gate.ts`; it requires `MERMER_ENABLE_DEV_SIGNER=1`, is disabled outside local non-production mode, and exists only to verify the browser `LoginCard` path without a wallet extension.
- The CLI projection script remains the fallback, but hosted checkout can now complete the read-model handoff without exposing operator credentials.
