---
title: "CardForge integration"
description: "Run CardForge as a standalone merchant demo that consumes ZamaPay through raw HTTP and signed webhooks."
badge: "Demo"
icon: "receipt"
group: "Examples"
order: 90
featured: false
---

## Standalone boundary {% #standalone-boundary %}

CardForge is a merchant template, not a ZamaPay internal route. It owns its storefront, backend database, order state, fulfillment, and webhook receiver.

| Surface | Owner | Boundary |
| --- | --- | --- |
| ZamaPay merchant console | ZamaPay | Creates projects, issues `ZAMAPAY_SECRET_KEY`, manages balances and withdraw. |
| CardForge backend | Merchant | Stores orders, calls ZamaPay with `ZAMAPAY_SECRET_KEY`, verifies webhooks. |
| CardForge frontend | Merchant | Starts orders and redirects buyers to hosted checkout. |
| ZamaPay hosted checkout | ZamaPay | Owns wallet payment UX and rail-specific payment truth. |

{% figure kind="cardforge" /%}

## CardForge env files {% #cardforge-env-files %}

CardForge needs one project secret export and its own runtime values.

| Variable | Source | Meaning |
| --- | --- | --- |
| `ZAMAPAY_SECRET_KEY` | Project dialog | `zms_test_...` server-side project secret used by CardForge to bootstrap project and webhook context. |
| `ZAMAPAY_API_URL` | Env template | Shared deployment API base URL. |
| `CARDFORGE_DATABASE_URL` | Env template | Independent CardForge Postgres database URL. |
| `CARDFORGE_PAYMENT_RAIL` | Env template | `zama_private` or `evm_erc20`. |
| `CARDFORGE_EVM_CHAIN_ID` | ERC20 demo | Local chain id, normally `31337`. |
| `CARDFORGE_EVM_TOKEN_SYMBOL` | ERC20 demo | `USDT` or `USDC`. |
| `CARDFORGE_WEBHOOK_ENDPOINT` | Optional | Defaults to `http://127.0.0.1:8092/api/zamapay/webhook`. |

```bash
just seed-cardforge-local-project
just cardforge-api-local
just cardforge-web-local
```

## Closed loop proof {% #closed-loop-proof %}

Use the browser-created project path when validating merchant-wallet withdraw because the project owner must match the wallet account used in the merchant console.

```bash
just verify-local
just verify-evm-local --funding-method all
```

Manual proof should capture the checkout id, payment intent id, funding method, settlement tx hash, webhook delivery id, order release state, project balance row, withdrawal id, and withdrawal receipt.
