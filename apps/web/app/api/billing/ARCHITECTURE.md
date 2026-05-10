# Billing API Route Architecture

## Tree

```text
apps/web/app/api/billing
`-- project-growth/route.ts # Verifies finalized chain Growth entitlement and projects Rust billing truth
```

## Decisions

- Browser wallets own the encrypted subscription request and, on Sepolia, the finalization transaction.
- This route only verifies the configured-chain `SubscriptionChangeFinalized` event and forwards the entitlement to Rust with `ZAMAPAY_OPERATOR_KEY`.
- Local-dev may keep the server-side finalize shim for demo speed; Sepolia must use the Zama official test relayer for FHE proofs before this route is called.
