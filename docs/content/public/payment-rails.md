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

## ERC20 funding methods {% #erc20-funding-methods %}

The ordinary EVM rail has multiple funding entrypoints, but only one ledger path. A buyer may fund settlement through the best capability exposed by the asset catalog:

| Method | Use | Wallet interaction | Settlement truth |
| --- | --- | --- | --- |
| `eip3009` | USDC/EURC-style signed authorization | Buyer signs `ReceiveWithAuthorization`; the ZamaPay relayer submits `payWithAuthorization` when enabled, otherwise the buyer submits it. | Settlement receives exact gross, then emits unchanged `EvmPaymentAccepted`. |
| `permit2` | USDT and generic ERC20s with Permit2 setup | Buyer approves Permit2 once, then signs a Permit2 witness; the relayer can submit `payWithPermit2`. | Witness binds intent, project, payer, token, amount split, settlement, chain, and deadline. Local-dev deploys a Permit2-compatible signature-transfer contract so USDT tests exercise the product path instead of an ad hoc mock. |
| `erc2612` | Tokens with native `permit` | Buyer signs token permit and submits `payWithPermit` from the payer wallet. | The contract requires `msg.sender == payer`; native permit alone is not business intent. |
| `approve_pay` | Universal fallback | Buyer approves settlement and submits `pay`. | Exact token balance delta is checked before ledger acceptance. |

The API returns ranked `EvmFundingAction` descriptors for the checkout. Frontends must not infer capability from token symbol. If an action is disabled, show its reason and fall back to the next ranked action.

The relayer is a facilitator, not a custodian and not a payment oracle. It pays gas and submits a buyer-signed settlement call; it does not hold merchant funds, cannot rewrite the amount split, and must not project `paid`. A checkout is paid only after the indexer observes `EvmPaymentAccepted` from the settlement contract at the required confirmations.

{% callout title="Single settlement path" type="warning" %}
Every funding method must follow the same order: prevalidate the payment intent, perform the external token funding call, check exact settlement token balance delta, then write the accepted-intent replay guard plus merchant/platform balances and emit `EvmPaymentAccepted`. `_acceptPayment` must never perform token calls or duplicate the event payload into long-lived storage.
{% /callout %}

## Operational discipline {% #rail-discipline %}

1. Create or enable chain, token, RPC, and settlement-contract catalog rows before exposing an ERC20 asset.
2. Declare token funding capabilities in the catalog: USDC/EURC prefer EIP-3009 where the token supports it; USDT must expose Permit2; ERC-2612 and standard approval are fallbacks.
3. Create a backend-owned payment intent for each checkout.
4. Show the buyer exact network, token, amount, settlement contract, expiry, and selected funding method.
5. Let the EVM indexer advance state only from settlement contract events and confirmation thresholds.
6. Keep exceptions visible for wrong token, wrong amount, duplicate events, expired intents, and reorg evidence.
7. Trigger webhook release only after the rail reaches finality-safe truth.
8. Configure the relayer as an operational signer with gas policy and monitoring; it is allowed to submit only canonical funding actions returned by the platform API.

{% callout title="No manual paid projection" type="warning" %}
ERC20 checkouts must not use tx-hash-only operator projection. The chain event is the source of truth, and the delivery layer only reports that truth to merchants.
{% /callout %}

{% callout title="No Transfer-log truth" type="warning" %}
Token `Transfer` logs are funding evidence, not payment truth. Do not build a second payment system around raw token transfers, and do not use plain Permit2 `permitTransferFrom` for checkout payment. Permit2 must use witness binding.
{% /callout %}
