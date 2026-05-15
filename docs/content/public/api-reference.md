---
title: "API reference"
description: "The merchant-facing API boundary for project-secret bootstrap, checkout sessions, idempotency, and rail-specific fields."
badge: "API"
icon: "key"
group: "Build"
order: 60
featured: false
---

## Authentication boundaries {% #auth-model %}

The browser dashboard and merchant server API are different trust domains.

| Boundary | Credential | Use |
| --- | --- | --- |
| Merchant console | Wallet session cookie | Create projects, reveal one-time project secret, manage rails, inspect balances, withdraw. |
| Merchant backend | `Authorization: Bearer zms_...` | Bootstrap project context and create or retrieve checkout sessions. |
| Webhook receiver | `whsec_...` verifier secret | Verify `svix-*` headers against the raw body. |
| ZamaPay API process | `ZAMAPAY_SECRET_ENCRYPTION_KEY` | Encrypt endpoint secrets at rest; never belongs to merchants. |

{% figure kind="api-handoff" /%}

## Bootstrap project context {% #bootstrap-project %}

Merchant backends can derive project id and webhook verifier context from the single project secret. This keeps project setup close to the Stripe-style "one server secret plus shared API URL" model.

```http
GET /api/project-secret/bootstrap
Authorization: Bearer zms_test_...
ZamaPay-Version: 2026-05-14
```

Response fields:

| Field | Meaning |
| --- | --- |
| `projectId` | Project id used for project-scoped checkout routes. |
| `environment` | Contract environment label for the project. |
| `webhookEndpointId` | Current endpoint id when a webhook endpoint exists. |
| `webhookEndpointUrl` | Endpoint URL registered by the merchant. |
| `webhookSecret` | Current verifier secret only when the backend is allowed to reveal or bootstrap it. |

Do not expose bootstrap responses to the browser. The response can contain webhook verification material for the merchant backend.

## Create a checkout session {% #create-checkout %}

Checkout creation is project-scoped, idempotent, and rail-explicit.

```http
POST /api/projects/{projectId}/checkout-sessions
Authorization: Bearer zms_test_...
ZamaPay-Version: 2026-05-14
idempotency-key: order_1001
content-type: application/json
```

Common request fields:

| Field | Meaning |
| --- | --- |
| `merchantOrderId` | Merchant's order id for reconciliation. |
| `title` | Buyer-visible checkout title. |
| `amountLabel` | Buyer-visible amount label. |
| `amountMinorUnits` | Amount in token minor units. |
| `note` | Buyer-visible note. |
| `paymentRail` | `zama_private` or `evm_erc20`. |

Rail-specific request fields:

| Rail | Fields |
| --- | --- |
| `zama_private` | `chainInvoiceId`, `chainTxHash` |
| `evm_erc20` | `evmChainId`, `evmTokenSymbol` |

## Errors and retries {% #errors-retries %}

The merchant API returns typed error envelopes. Clients should retry connection failures, timeouts, `429`, and retryable `5xx` responses with idempotency keys. Do not retry validation errors by changing the same idempotency key payload.

| Status | Meaning |
| --- | --- |
| `400` | Invalid request or missing rail-specific field. |
| `401` | Missing or invalid project secret. |
| `403` | Project secret is valid but not allowed for the requested project. |
| `409` | Idempotency conflict. |
| `429` | Rate limited; respect `Retry-After` when present. |
