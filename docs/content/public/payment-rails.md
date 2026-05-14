---
title: "Payment Rails"
description: "Separate the merchant project from each payment truth source: Zama private checkout and ordinary EVM ERC20 settlement."
badge: "Rails"
icon: "boxes"
group: "Build"
order: 50
featured: true
---

## Rail model {% #rail-model %}

A payment project can use both rails, but every checkout session chooses exactly one. The receipt, dashboard row, webhook payload, and balance movement must keep that rail identity visible.

| Rail | Buyer experience | Payment truth | Funds boundary | Withdrawal |
| --- | --- | --- | --- | --- |
| `zama_private` | Hosted private checkout with encrypted cUSDT payment | Zama private invoice plus finality-gated private settlement projection | Private checkout contract and encrypted pending buckets | Merchant signs the private withdraw path. |
| `evm_erc20` | Hosted ERC20 checkout with network, token, amount, and settlement contract | Indexed `EvmCheckoutSettlement.EvmPaymentAccepted` log with confirmations | Backend-created settlement intent and settlement contract custody | Merchant withdraws confirmed token balance through the settlement contract path. |

The ordinary EVM rail is not a button layered on the private checkout. It is a normal ERC20 receiving rail with its own asset catalog, settlement intent, event ledger, finality cursor, dashboard balance, and withdraw path.

## Operational discipline {% #rail-discipline %}

1. Create or enable chain, token, RPC, and settlement-contract catalog rows before exposing an ERC20 asset.
2. Create a backend-owned payment intent for each checkout.
3. Show the buyer exact network, token, amount, settlement contract, expiry, and wallet action.
4. Let the EVM indexer advance state only from settlement contract events and confirmation thresholds.
5. Keep exceptions visible for wrong token, wrong amount, duplicate events, expired intents, and reorg evidence.
6. Trigger webhook release only after the rail reaches finality-safe truth.

{% callout title="No manual paid projection" type="warning" %}
ERC20 checkouts must not use tx-hash-only operator projection. The chain event is the source of truth, and the delivery layer only reports that truth to merchants.
{% /callout %}
