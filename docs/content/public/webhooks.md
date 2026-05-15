---
title: "Webhooks"
description: "Verify ZamaPay webhook deliveries with Svix-style raw-body HMAC headers and endpoint-scoped secrets."
badge: "Delivery"
icon: "webhook"
group: "Operate"
order: 70
featured: false
---

## Delivery model {% #delivery-model %}

Webhook delivery reports payment truth after a rail reaches a finality-safe state. It must not become a second payment projection system.

| Layer | Single truth |
| --- | --- |
| Event outbox | `zamapay_webhook_events` freezes the payload and stores the payload hash. |
| Delivery aggregate | `zamapay_webhook_deliveries` owns dispatch state, retry eligibility, and final result. |
| Attempt evidence | Delivery attempts store request/response evidence only; they are not schedulers. |
| Merchant verification | Receiver verifies `svix-id`, `svix-timestamp`, and `svix-signature` against raw bytes. |

{% figure kind="webhook-outbox" /%}

## Verify a webhook {% #verify-signature %}

ZamaPay signs the exact frozen raw body:

```text
base = "{svix-id}.{svix-timestamp}.{raw_body}"
signature = "v1," + base64(hmac_sha256(endpoint_secret, base))
```

The receiver must read raw bytes first, verify within the timestamp tolerance window, then parse JSON.

```ts
import { constructWebhookEvent } from "@zamapay/server/webhooks"

export async function POST(request: Request) {
  const rawBody = await request.text()
  const event = constructWebhookEvent(rawBody, request.headers, {
    secret: process.env.ZAMAPAY_WEBHOOK_SECRET!,
  })

  await handleZamaPayEvent(event)
  return Response.json({ received: true })
}
```

{% callout title="Raw body first" type="warning" %}
JSON reserialization changes whitespace and key order. A parsed object is not a webhook body and must fail verification.
{% /callout %}

## Local receiver tests {% #local-receiver-tests %}

Use the SDK helper when writing Node tests. Use the Rust CLI when you want an agent-readable smoke command that sends the same header shape to a running receiver.

```bash
cargo run -p zamapay-cli -- test-webhook \
  --url http://127.0.0.1:8092/api/zamapay/webhook \
  --secret "$ZAMAPAY_WEBHOOK_SECRET"
```

To debug a captured delivery, save the exact raw body bytes and verify the received headers without parsing JSON first:

```bash
cargo run -p zamapay-cli -- verify-webhook \
  --body-file webhook.raw.json \
  --svix-id msg_123 \
  --svix-timestamp 1778767200 \
  --svix-signature "v1,..." \
  --secret "$ZAMAPAY_WEBHOOK_SECRET"
```

If verification passes for the saved raw body but fails in the app, the receiver probably parsed or reserialized the body before verification.

## Secret rotation {% #secret-rotation %}

Each webhook endpoint has its own `whsec_...` secret. Rotation promotes a new current secret and keeps retired secrets valid for a short overlap window so deploys can roll safely.

The browser console reveals secrets only at creation or rotation. Merchant backends can bootstrap verifier context with `ZAMAPAY_SECRET_KEY`, but public APIs must not return frozen raw payloads or reusable signature material.
