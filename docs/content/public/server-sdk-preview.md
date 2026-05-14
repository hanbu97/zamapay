---
title: "Server SDK Preview"
description: "Use the server-side TypeScript SDK from a merchant backend without leaking project secrets to the browser."
badge: "Preview SDK"
icon: "braces"
group: "Build"
order: 30
featured: true
---

## Create a checkout {% #server-sdk-create %}

`@zamapay/server` is a Node/server package for merchant backends. It uses native `fetch`, `node:crypto`, project-secret Bearer auth, and the fixed preview API version header.

Do not import this package from browser code. Do not place `ZAMAPAY_SECRET_KEY` or webhook `whsec_...` values in `NEXT_PUBLIC_*` variables.

```ts
import { PaymentRail, ZamaPayClient } from "@zamapay/server"

const zamapay = new ZamaPayClient({
  baseUrl: process.env.ZAMAPAY_API_URL ?? "https://api.zamapay.org",
  secretKey: process.env.ZAMAPAY_SECRET_KEY!,
})

const project = await zamapay.bootstrapProject()

const session = await zamapay.checkoutSessions.create({
  idempotencyKey: "order_1001",
  merchantOrderId: "order_1001",
  title: "Prepaid card bundle",
  amountLabel: "120 USDT",
  amountMinorUnits: 120000000,
  note: "Release after finality-safe payment",
  paymentRail: PaymentRail.EvmErc20,
  evmChainId: 31337,
  evmTokenSymbol: "USDT",
  successUrl: "https://merchant.example/success",
  cancelUrl: "https://merchant.example/cancel",
  metadata: { source: "merchant-backend" },
})

console.log(project.projectId, session.checkoutUrl)
```

## Contract boundary {% #server-sdk-contract %}

The SDK defaults to `ZamaPay-Version: 2026-05-14`. Checkout creation requires `paymentRail`. There is no SDK-side default because the private rail and ordinary ERC20 rail have different payment truth sources.

| Input | Required | Meaning |
| --- | --- | --- |
| `secretKey` | yes | `zms_...` project secret used only on the merchant backend. |
| `baseUrl` | deployment | ZamaPay API base URL. It is shared by a deployment, not unique per project. |
| `paymentRail` | yes | `zama_private` or `evm_erc20`; the SDK refuses missing or unknown values. |
| `idempotencyKey` | yes | Stable merchant request key sent as the `idempotency-key` header. |
| `evmChainId` and `evmTokenSymbol` | ERC20 rail | Selects the ordinary EVM token settlement intent. |
| `chainInvoiceId` and `chainTxHash` | private rail | Evidence from the Zama private invoice creation path. |

## Verify webhooks {% #server-sdk-webhooks %}

Webhook helpers are exported as a subpath of the server package. They verify the raw request body before JSON parsing and use the same Svix-style HMAC protocol as the Rust verifier.

`generateTestHeaders()` creates deterministic test headers for local receiver tests. Production receivers must use the platform-sent headers.

```ts
import { constructWebhookEvent, generateTestHeaders } from "@zamapay/server/webhooks"

export async function POST(request: Request) {
  const rawBody = await request.text()
  const event = constructWebhookEvent(rawBody, request.headers, {
    secret: process.env.ZAMAPAY_WEBHOOK_SECRET!,
  })

  await persistWebhookEvent(event)
  return new Response("ok")
}

const testHeaders = generateTestHeaders({
  messageId: "msg_test",
  payload: '{"type":"checkout.paid"}',
  secret: process.env.ZAMAPAY_WEBHOOK_SECRET!,
  timestamp: 1778767200,
})
```
