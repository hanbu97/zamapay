# Merchant API Fixtures Architecture

## Tree

```text
merchant-api/
`-- contract-v1.json       # Preview merchant API version, checkout DTOs, error envelopes, and webhook vectors
```

## Decisions

- `contract-v1.json` is the Phase 0 SDK contract boundary.
- It freezes sample bootstrap, discriminated checkout create/retrieve, rail selection, ordinary ERC20 settlement intent shape, normalized SDK error envelopes, and Svix-style webhook signing cases.
- The fixture must stay small and deterministic; live API smoke belongs in `just verify-sdk-local`, not here.
