# Runbooks Architecture

## Tree

```text
docs/runbooks
|-- implementation-status.md       # Prompt-to-artifact audit and remaining public-testnet gate
|-- local-hardhat-rail.md          # Local node, deploy, web/API, smoke, and standalone demo path
|-- private-checkout-v1.md         # Hackathon private checkout design with commitments, encrypted amount, and relayed payment
|-- sepolia-demo.md                # Sepolia deploy, manifest, browser relayer, and standalone demo path
`-- testnet-config.md              # Public Sepolia/Zama constants and remaining private wallet inputs
```

## Decisions

- `local-hardhat-rail.md` captures the stable local-chain operator path for node, deploy, manifest, API, and web smoke checks.
- `implementation-status.md` is the stop/go audit. It maps requirements to evidence and refuses completion until public-network evidence exists.
- `private-checkout-v1.md` freezes the hackathon proof target and current implementation with a field-contract table and Mermaid flows: scoped settlement-contract privacy, `MockConfidentialPaymentRail`, rotating settlement commitments, encrypted amounts, relayed payment, and only a paid/rejected boolean decrypt per order.
- `sepolia-demo.md` captures the testnet deployment and browser payment path from manifest through checkout.
- `testnet-config.md` separates public Zama/Sepolia constants from private wallet-owned inputs.
- Demo documentation names `demo/cardforge` directly so the card issuing scenario is an artifact, not an oral convention.
