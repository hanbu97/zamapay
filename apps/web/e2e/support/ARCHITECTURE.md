# Web E2E Support Architecture

## Tree

```text
apps/web/e2e/support
|-- auth.ts          # Wallet nonce/signature login helper for live Rust API specs
`-- http.ts          # Shared API/web base URLs plus JSON/text request helpers
```

## Decisions

- Support helpers contain transport and session mechanics only; spec files own scenario setup and assertions.
- `auth.ts` uses the same Rust nonce and signature path as the browser login flow, so e2e tests do not bypass authentication.
- `http.ts` centralizes local service URLs and operator-key headers to avoid each spec inventing a subtly different test client.
