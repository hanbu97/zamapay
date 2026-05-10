# Runbooks Architecture

## Tree

```text
docs/runbooks
|-- implementation-status.md
|-- local-hardhat-rail.md
`-- private-checkout-v1.md
```

## Decisions

- `local-hardhat-rail.md` captures the stable local-chain path for Postgres, Hardhat, deploy, manifest, API, web, and readiness checks.
- `implementation-status.md` is the stop/go audit for local-dev and Sepolia, with Sepolia FHE proofs explicitly routed through Zama's official test relayer.
- `private-checkout-v1.md` freezes the hackathon proof target with a field-contract table and Mermaid flows: scoped settlement-contract privacy, `ConfidentialUSDMock`, rotating commitments, encrypted amounts, direct buyer payment, and only one paid/rejected boolean decrypt per order.
