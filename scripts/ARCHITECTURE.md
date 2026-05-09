# Scripts Architecture

## Tree

```text
scripts
|-- local-full-verify.js # Sequential local acceptance gate across web, Rust, contracts, and readiness
|-- local-readiness.js    # One-command verifier across manifest, API, wallet login, dev-signer boundary, web, smoke, and projection
|-- merchant-project-loop.js # Deterministic project/API-key/CardForge/webhook/dashboard loop
`-- sepolia-handoff.js    # Funded-wallet Sepolia handoff: preflight, deploy if needed, mint test USD, and verify
```

## Decisions

- Root scripts verify cross-package readiness. Package-local scripts stay in `contracts/scripts` or the owning crate.
- `local-full-verify.js` is the final local acceptance gate; it stops at the first failed unit test, live web e2e test, build, contract check, Rust check, or readiness proof.
- `local-readiness.js` is intentionally dependency-light Node: it uses existing workspace packages only, including `viem` for the local wallet-login proof, and verifies hosted checkout state without merchant-template artifacts.
- `merchant-project-loop.js` proves the merchant-platform loop end to end: project creation, one-time API key, CardForge Free checkout, local payment projection, Growth entitlement projection, second Growth checkout, signed webhooks, and dashboard stats.
- `sepolia-handoff.js` is the public-testnet continuation gate. It refuses to deploy until signer, buyer, secrets, RPC, and amount checks pass, then reuses an existing Sepolia manifest unless `MERMER_FORCE_SEPOLIA_DEPLOY=1`.
- The verifier treats Rust API, Next web, Hardhat localhost, and generated local manifest as one readiness boundary.
