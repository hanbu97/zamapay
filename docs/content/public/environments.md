---
title: "Environments"
description: "Keep local-dev, Supabase-backed local runs, Sepolia local UI, and preview validation explicit."
badge: "Ops"
icon: "clipboard"
group: "Operate"
order: 110
featured: false
---

## Environment policy {% #environment-policy %}

Runtime profiles describe how processes are composed. Contract environments describe which chain deployment a project targets. Do not use either as a multi-chain ERC20 asset catalog.

| Profile | API/Web | Chain | Purpose |
| --- | --- | --- | --- |
| `local-dev` | Local API and local Next app | Hardhat local chain | Default development and deterministic E2E. |
| `sepolia-local-ui` | Local API and local Next app | Sepolia contracts | Public-testnet UI validation without hosted frontend deployment. |
| `sepolia-preview` | Preview deployment checks | Sepolia contracts | Public preview readiness validation. |

## Local readiness {% #local-readiness %}

```bash
just db-up
just contracts-node
just reset-local
just api-local
just evm-indexer-local
just web-local
just verify-local
```

Use `ZAMAPAY_LOCAL_API_PORT=<port>` consistently across local API, web, CardForge, and verify recipes when `18080` is unavailable.

## Sepolia readiness {% #sepolia-readiness %}

```bash
just verify-runtime sepolia-local-ui
just deploy-sepolia-contracts
just api-sepolia-local-ui
just web-sepolia-local-ui
just cardforge-api-sepolia-local-ui
just cardforge-web-sepolia-local-ui
```

Sepolia and future public ERC20 support should be enabled only by explicit chain, token, RPC, and settlement-contract catalog rows. Payment truth must come from indexed settlement events and confirmation thresholds, not manual transaction hash projection.
