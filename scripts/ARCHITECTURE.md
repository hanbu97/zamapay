# Scripts Architecture

## Tree

```text
scripts
|-- local-full-verify.js
`-- local-readiness.js
```

## Decisions

- Root scripts verify cross-package local-dev readiness. Package-local contract tasks stay in `contracts/scripts`.
- `local-full-verify.js` is the final local acceptance gate; it stops at the first failed unit test, live web e2e test, build, contract check, Rust check, or readiness proof.
- `local-readiness.js` is dependency-light Node and verifies the local manifest, Rust API, Next pages, wallet login, and dev-signer boundary.
- The old merchant loop script was removed because it wrote payment projections directly; the accepted checkout path now proves payment through `PrivateCheckoutSettlement`.
- Public-testnet handoff is removed from active scripts until protocol-fee and relayer funding policy are explicit.
