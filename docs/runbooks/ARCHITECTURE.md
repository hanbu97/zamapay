# Runbooks Architecture

## Tree

```text
docs/runbooks
|-- development-deployment-workflow.md
|-- implementation-status.md
|-- local-hardhat-rail.md
`-- private-checkout-v1.md
```

## Decisions

- `development-deployment-workflow.md` is the top-level operating path for mise, just, runtime profiles, local-dev, CardForge binding, Svix-style webhook verification, Sepolia local-UI, preview checks, and recovery.
- `local-hardhat-rail.md` captures the stable local-chain path for Postgres, Hardhat, deploy, manifest, API, web, and readiness checks.
- `implementation-status.md` is the stop/go audit for local-dev and Sepolia, with Sepolia FHE proofs explicitly routed through Zama's official test relayer.
- `private-checkout-v1.md` freezes the hackathon proof target with a field-contract table and Mermaid flows: scoped settlement-contract privacy, `ConfidentialUSDMock`, rotating commitments, encrypted amounts, direct buyer payment, and only one paid/rejected boolean decrypt per order.
