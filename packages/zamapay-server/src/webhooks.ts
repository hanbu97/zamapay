import { createHmac, timingSafeEqual } from "node:crypto"
import { ZamaPayWebhookVerificationError } from "./errors.ts"

export const SVIX_ID_HEADER = "svix-id"
export const SVIX_TIMESTAMP_HEADER = "svix-timestamp"
export const SVIX_SIGNATURE_HEADER = "svix-signature"
export const WEBHOOK_SECRET_PREFIX = "whsec_"
export const WEBHOOK_SIGNATURE_VERSION = "v1"
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60

export type RawWebhookBody = string | Uint8Array | ArrayBuffer

export type WebhookHeaders =
  | Record<string, string | string[] | undefined>
  | {
      get(name: string): string | null
    }

export type WebhookVerificationOptions = {
  nowUnixSeconds?: number
  secret: string
  toleranceSeconds?: number
}

export type WebhookTestHeaderOptions = {
  messageId?: string
  payload: RawWebhookBody
  secret: string
  timestamp?: number
}

export type WebhookTestHeaders = Record<typeof SVIX_ID_HEADER | typeof SVIX_SIGNATURE_HEADER | typeof SVIX_TIMESTAMP_HEADER, string>

export function verifyWebhook(
  rawBody: RawWebhookBody,
  headers: WebhookHeaders,
  options: WebhookVerificationOptions,
): true {
  const body = rawBodyToString(rawBody)
  const messageId = requiredHeader(headers, SVIX_ID_HEADER)
  const timestamp = requiredHeader(headers, SVIX_TIMESTAMP_HEADER)
  const signature = requiredHeader(headers, SVIX_SIGNATURE_HEADER)
  const now = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS

  verifyTimestamp(timestamp, now, tolerance)
  verifySignature(options.secret, messageId, timestamp, signature, body)

  return true
}

export function generateTestHeaders(options: WebhookTestHeaderOptions): WebhookTestHeaders {
  const messageId = options.messageId ?? `msg_test_${Date.now()}`
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))

  return {
    [SVIX_ID_HEADER]: messageId,
    [SVIX_SIGNATURE_HEADER]: generateTestHeaderString({
      ...options,
      messageId,
      timestamp: Number(timestamp),
    }),
    [SVIX_TIMESTAMP_HEADER]: timestamp,
  }
}

export function generateTestHeaderString(options: WebhookTestHeaderOptions): string {
  const messageId = options.messageId ?? `msg_test_${Date.now()}`
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
  return signatureFor(options.secret, messageId, timestamp, rawBodyToString(options.payload))
}

export function constructWebhookEvent<T = unknown>(
  rawBody: RawWebhookBody,
  headers: WebhookHeaders,
  options: WebhookVerificationOptions,
): T {
  verifyWebhook(rawBody, headers, options)

  try {
    return JSON.parse(rawBodyToString(rawBody)) as T
  } catch {
    throw new ZamaPayWebhookVerificationError("webhook payload is not valid JSON")
  }
}

function verifyTimestamp(timestamp: string, nowUnixSeconds: number, toleranceSeconds: number): void {
  if (!/^\d+$/.test(timestamp)) {
    throw new ZamaPayWebhookVerificationError("invalid webhook timestamp", {
      code: "invalid_timestamp",
    })
  }

  const sentAt = Number(timestamp)
  if (!Number.isSafeInteger(sentAt) || sentAt < 0) {
    throw new ZamaPayWebhookVerificationError("invalid webhook timestamp", {
      code: "invalid_timestamp",
    })
  }

  if (sentAt + toleranceSeconds < nowUnixSeconds) {
    throw new ZamaPayWebhookVerificationError("webhook timestamp is outside the replay window", {
      code: "timestamp_too_old",
    })
  }

  if (sentAt > nowUnixSeconds + toleranceSeconds) {
    throw new ZamaPayWebhookVerificationError("webhook timestamp is too far in the future", {
      code: "timestamp_too_far_in_future",
    })
  }
}

function verifySignature(
  secret: string,
  messageId: string,
  timestamp: string,
  signatureHeader: string,
  rawBody: string,
): void {
  const expected = signatureFor(secret, messageId, timestamp, rawBody)
  const valid = signatureHeader
    .split(/\s+/)
    .filter(Boolean)
    .some((candidate) => safeEqual(candidate, expected))

  if (!valid) {
    throw new ZamaPayWebhookVerificationError("invalid webhook signature", {
      code: "invalid_signature",
    })
  }
}

function webhookSecretKey(secret: string): Buffer {
  const body = secret.startsWith(WEBHOOK_SECRET_PREFIX) ? secret.slice(WEBHOOK_SECRET_PREFIX.length) : secret
  const normalized = body.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new ZamaPayWebhookVerificationError("invalid webhook secret", {
      code: "invalid_secret",
    })
  }

  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  const key = Buffer.from(padded, "base64")
  const canonical = key.toString("base64").replace(/=+$/, "")
  if (key.length === 0 || canonical !== normalized.replace(/=+$/, "")) {
    throw new ZamaPayWebhookVerificationError("invalid webhook secret", {
      code: "invalid_secret",
    })
  }

  return key
}

function signatureFor(secret: string, messageId: string, timestamp: string, rawBody: string): string {
  const base = `${messageId}.${timestamp}.${rawBody}`
  return `${WEBHOOK_SIGNATURE_VERSION},${createHmac("sha256", webhookSecretKey(secret)).update(base).digest("base64")}`
}

function requiredHeader(headers: WebhookHeaders, name: string): string {
  const value = readHeader(headers, name)
  if (!value) {
    throw new ZamaPayWebhookVerificationError(`missing ${name} header`, {
      code: "missing_header",
    })
  }

  return value
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if ("get" in headers && typeof headers.get === "function") {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) {
      continue
    }

    return Array.isArray(value) ? value.join(" ") : value
  }

  return undefined
}

function rawBodyToString(rawBody: RawWebhookBody): string {
  if (typeof rawBody === "string") {
    return rawBody
  }

  if (rawBody instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(rawBody)).toString("utf8")
  }

  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody).toString("utf8")
  }

  throw new ZamaPayWebhookVerificationError(
    "webhook payload must be the raw request body string or bytes, not a parsed JSON object",
    {
      code: "invalid_raw_body",
    },
  )
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
