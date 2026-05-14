---
title: "Examples"
description: "Small server-side examples for checkout creation, webhook verification, and frontend redirect handoff."
badge: "Examples"
icon: "receipt"
group: "Examples"
order: 80
featured: false
---

## Checkout creation {% #example-create-checkout %}

This Express-style handler creates an ordinary ERC20 checkout from server code. It keeps `ZAMAPAY_SECRET_KEY` on the server and sends only the returned hosted checkout URL to the browser.

```ts
import express from "express"
import { PaymentRail, ZamaPayClient } from "@zamapay/server"

const app = express()
const zamapay = new ZamaPayClient({
  baseUrl: process.env.ZAMAPAY_API_URL!,
  secretKey: process.env.ZAMAPAY_SECRET_KEY!,
})

app.post("/orders/:orderId/checkout", express.json(), async (request, response) => {
  const session = await zamapay.checkoutSessions.create({
    idempotencyKey: request.params.orderId,
    merchantOrderId: request.params.orderId,
    title: "CardForge loadout",
    amountLabel: "120 USDT",
    amountMinorUnits: 120000000,
    note: "Release after ERC20 finality",
    paymentRail: PaymentRail.EvmErc20,
    evmChainId: 31337,
    evmTokenSymbol: "USDT",
  })

  response.json({ checkoutUrl: session.checkoutUrl })
})
```

## Webhook receiver {% #example-webhook %}

Webhook receivers verify first and mutate local order state second.

```ts
import express from "express"
import { constructWebhookEvent } from "@zamapay/server/webhooks"

const app = express()

app.post("/webhooks/zamapay", express.raw({ type: "application/json" }), async (request, response) => {
  const event = constructWebhookEvent(request.body, request.headers, {
    secret: process.env.ZAMAPAY_WEBHOOK_SECRET!,
  })

  if (event.type === "checkout.finality_safe") {
    await releaseOrder(event.data.merchantOrderId)
  }

  response.json({ received: true })
})
```

## Frontend redirect {% #frontend-redirect %}

The merchant frontend calls its own backend, then navigates to the hosted checkout URL. It never receives the project secret.

```ts
const response = await fetch(`/orders/${orderId}/checkout`, { method: "POST" })
const { checkoutUrl } = await response.json()
window.location.assign(checkoutUrl)
```
