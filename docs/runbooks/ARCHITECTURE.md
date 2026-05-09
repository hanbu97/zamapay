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
- `implementation-status.md` is the local-dev stop/go audit. Public testnet completion criteria are intentionally removed until protocol-fee policy exists.
- `private-checkout-v1.md` freezes the hackathon proof target with a field-contract table and Mermaid flows: scoped settlement-contract privacy, `MockConfidentialPaymentRail`, rotating commitments, encrypted amounts, relayed payment, and only one paid/rejected boolean decrypt per order.
