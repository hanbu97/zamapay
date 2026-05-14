import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import {
  constructWebhookEvent,
  generateTestHeaders,
  verifyWebhook,
  ZamaPayWebhookVerificationError,
} from "../src/index.ts"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/merchant-api/contract-v1.json"), "utf8"),
)

test("constructs webhook events from the valid raw body vector", () => {
  const vector = fixture.webhooks.valid
  const event = constructWebhookEvent(vector.rawBody, vector.headers, {
    nowUnixSeconds: vector.nowUnixSeconds,
    secret: fixture.webhooks.currentSecret,
  }) as { checkoutSessionId: string; paymentRail: string }

  assert.equal(event.checkoutSessionId, "cs_sdk_zama")
  assert.equal(event.paymentRail, "zama_private")
})

test("rejects JSON whitespace and order changes because the signature covers raw bytes", () => {
  const vector = fixture.webhooks.valid

  assert.throws(
    () =>
      constructWebhookEvent(fixture.webhooks.tamperedBody.rawBody, vector.headers, {
        nowUnixSeconds: vector.nowUnixSeconds,
        secret: fixture.webhooks.currentSecret,
      }),
    (error) => error instanceof ZamaPayWebhookVerificationError && error.code === "invalid_signature",
  )
})

test("rejects expired timestamps", () => {
  const vector = fixture.webhooks.valid

  assert.throws(
    () =>
      verifyWebhook(vector.rawBody, vector.headers, {
        nowUnixSeconds: fixture.webhooks.expired.nowUnixSeconds,
        secret: fixture.webhooks.currentSecret,
      }),
    (error) => error instanceof ZamaPayWebhookVerificationError && error.code === "timestamp_too_old",
  )
})

test("rejects invalid whsec values", () => {
  const vector = fixture.webhooks.valid

  assert.throws(
    () =>
      verifyWebhook(vector.rawBody, vector.headers, {
        nowUnixSeconds: vector.nowUnixSeconds,
        secret: fixture.webhooks.invalidSecret.secret,
      }),
    (error) => error instanceof ZamaPayWebhookVerificationError && error.code === "invalid_secret",
  )
})

test("accepts current or retired secrets when a rotated delivery carries multiple signatures", () => {
  const vector = fixture.webhooks.valid
  const headers = fixture.webhooks.rotation.headers

  assert.equal(
    verifyWebhook(vector.rawBody, headers, {
      nowUnixSeconds: vector.nowUnixSeconds,
      secret: fixture.webhooks.currentSecret,
    }),
    true,
  )
  assert.equal(
    verifyWebhook(vector.rawBody, headers, {
      nowUnixSeconds: vector.nowUnixSeconds,
      secret: fixture.webhooks.retiredSecret,
    }),
    true,
  )
})

test("generates Svix-style test headers for raw body fixtures", () => {
  const vector = fixture.webhooks.valid
  const headers = generateTestHeaders({
    messageId: vector.messageId,
    payload: vector.rawBody,
    secret: fixture.webhooks.currentSecret,
    timestamp: Number(vector.headers["svix-timestamp"]),
  })

  assert.equal(headers["svix-id"], vector.messageId)
  assert.equal(headers["svix-timestamp"], vector.headers["svix-timestamp"])
  const event = constructWebhookEvent<{ checkoutSessionId: string }>(vector.rawBody, headers, {
      nowUnixSeconds: vector.nowUnixSeconds,
      secret: fixture.webhooks.currentSecret,
    })

  assert.equal(event.checkoutSessionId, "cs_sdk_zama")
})

test("explains parsed-object misuse before signature verification", () => {
  const vector = fixture.webhooks.valid

  assert.throws(
    () =>
      verifyWebhook(JSON.parse(vector.rawBody) as never, vector.headers, {
        nowUnixSeconds: vector.nowUnixSeconds,
        secret: fixture.webhooks.currentSecret,
      }),
    (error) => error instanceof ZamaPayWebhookVerificationError && error.code === "invalid_raw_body",
  )
})
