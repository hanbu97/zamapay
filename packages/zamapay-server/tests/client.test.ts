import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import {
  PaymentRail,
  ZAMAPAY_API_VERSION_HEADER,
  ZAMAPAY_PREVIEW_API_VERSION,
  ZamaPayAuthenticationError,
  ZamaPayApiError,
  ZamaPayClient,
  ZamaPayConnectionError,
  ZamaPayIdempotencyError,
  ZamaPayInvalidRequestError,
  ZamaPayPermissionError,
  ZamaPayRateLimitError,
  type FetchLike,
} from "../src/index.ts"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../fixtures/merchant-api/contract-v1.json"), "utf8"),
)

test("sends bearer auth, API version, and normalized base URL", async () => {
  const calls: RecordedRequest[] = []
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test///",
    fetch: fakeFetch(calls),
    secretKey: "zms_test_fixture",
  })

  const bootstrap = await client.bootstrapProject()

  assert.equal(bootstrap.projectId, "proj_sdk_fixture")
  assert.equal(calls[0].input, "https://api.example.test/api/project-secret/bootstrap")
  assert.equal(calls[0].init.headers.Accept, "application/json")
  assert.equal(calls[0].init.headers.Authorization, "Bearer zms_test_fixture")
  assert.match(calls[0].init.headers["User-Agent"], /^ZamaPay\//)
  assert.equal(calls[0].init.headers[ZAMAPAY_API_VERSION_HEADER], ZAMAPAY_PREVIEW_API_VERSION)
  assert.equal(bootstrap.lastResponse.requestId, "req_fixture")
})

test("creates both payment rails with explicit paymentRail and idempotency-key", async () => {
  const calls: RecordedRequest[] = []
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: fakeFetch(calls),
    projectId: "proj_sdk_fixture",
    secretKey: "zms_test_fixture",
  })

  await client.checkoutSessions.create({
    ...fixture.checkoutSessions.createZamaPrivate.request,
    idempotencyKey: "order_sdk_zama",
  })
  await client.checkoutSessions.create({
    ...fixture.checkoutSessions.createEvmErc20.request,
    idempotencyKey: "order_sdk_evm",
  })

  const privateCall = calls[0]
  const evmCall = calls[1]
  assert.equal(privateCall.init.headers["idempotency-key"], "order_sdk_zama")
  assert.equal(evmCall.init.headers["idempotency-key"], "order_sdk_evm")
  assert.equal(JSON.parse(privateCall.init.body ?? "{}").paymentRail, PaymentRail.ZamaPrivate)
  assert.equal(JSON.parse(evmCall.init.body ?? "{}").paymentRail, PaymentRail.EvmErc20)
  assert.equal(JSON.parse(privateCall.init.body ?? "{}").idempotencyKey, undefined)
  assert.equal(JSON.parse(privateCall.init.body ?? "{}").evmChainId, undefined)
  assert.equal(JSON.parse(privateCall.init.body ?? "{}").evmTokenSymbol, undefined)
  assert.equal(JSON.parse(evmCall.init.body ?? "{}").chainInvoiceId, undefined)
  assert.equal(JSON.parse(evmCall.init.body ?? "{}").chainTxHash, undefined)
})

test("requires explicit paymentRail and idempotency key", async () => {
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: fakeFetch([]),
    projectId: "proj_sdk_fixture",
    secretKey: "zms_test_fixture",
  })

  await assert.rejects(
    () =>
      client.checkoutSessions.create({
        ...fixture.checkoutSessions.createEvmErc20.request,
        idempotencyKey: "order_sdk_evm",
        paymentRail: undefined,
      }),
    /paymentRail must be one of/,
  )

  await assert.rejects(
    () =>
      client.checkoutSessions.create({
        ...fixture.checkoutSessions.createEvmErc20.request,
        idempotencyKey: "",
      }),
    ZamaPayApiError,
  )

  await assert.rejects(
    () =>
      client.checkoutSessions.create({
        ...fixture.checkoutSessions.createEvmErc20.request,
        chainInvoiceId: null,
        idempotencyKey: "order_sdk_evm",
      }),
    ZamaPayInvalidRequestError,
  )
})

test("retrieves checkout sessions through project secret auth", async () => {
  const calls: RecordedRequest[] = []
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: fakeFetch(calls),
    projectId: "proj_sdk_fixture",
    secretKey: "zms_test_fixture",
  })

  const checkout = await client.checkoutSessions.retrieve("cs_sdk_evm")

  assert.equal(checkout.checkoutSessionId, "cs_sdk_evm")
  assert.equal(calls[0].input, "https://api.example.test/api/projects/proj_sdk_fixture/checkout-sessions/cs_sdk_evm")
  assert.equal(calls[0].init.headers.Authorization, "Bearer zms_test_fixture")
})

test("normalizes API error envelopes into typed errors", async () => {
  const cases = [
    [fixture.errorEnvelopes.authentication.body, 401, ZamaPayAuthenticationError],
    [{ error: { message: "forbidden", type: "permission_error" } }, 403, ZamaPayPermissionError],
    [fixture.errorEnvelopes.idempotency.body, 400, ZamaPayIdempotencyError],
    [{ error: { message: "slow down", type: "rate_limit_error" } }, 429, ZamaPayRateLimitError],
    [{ error: { message: "bad request", type: "invalid_request_error" } }, 400, ZamaPayInvalidRequestError],
  ] as const

  for (const [body, status, errorClass] of cases) {
    const client = new ZamaPayClient({
      baseUrl: "https://api.example.test",
      fetch: async () => jsonResponse(body, status, { "x-request-id": "req_error" }),
      secretKey: "zms_test_fixture",
    })

    await assert.rejects(() => client.bootstrapProject(), errorClass)
  }
})

test("retries retryable network failures once for idempotent requests", async () => {
  const calls: RecordedRequest[] = []
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: async (input, init) => {
      calls.push({
        init: {
          body: init?.body,
          headers: init?.headers ?? {},
          method: init?.method,
          signal: init?.signal,
        },
        input,
      })

      if (calls.length === 1) {
        throw new TypeError("socket closed")
      }

      return jsonResponse(fixture.bootstrap.response)
    },
    secretKey: "zms_test_fixture",
  })

  await client.bootstrapProject()
  assert.equal(calls.length, 2)
})

test("retries retryable API responses and honors Retry-After", async () => {
  let calls = 0
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse({ error: { message: "busy", type: "api_error" } }, 500, { "retry-after": "0" })
      }
      return jsonResponse(fixture.bootstrap.response)
    },
    secretKey: "zms_test_fixture",
  })

  const bootstrap = await client.bootstrapProject()
  assert.equal(bootstrap.projectId, "proj_sdk_fixture")
  assert.equal(calls, 2)
})

test("wraps connection failures after retry budget is exhausted", async () => {
  const client = new ZamaPayClient({
    baseUrl: "https://api.example.test",
    fetch: async () => {
      throw new TypeError("network down")
    },
    maxNetworkRetries: 0,
    secretKey: "zms_test_fixture",
  })

  await assert.rejects(() => client.bootstrapProject(), ZamaPayConnectionError)
})

type RecordedRequest = {
  init: {
    body?: string
    headers: Record<string, string>
    method?: string
    signal?: AbortSignal
  }
  input: string
}

function fakeFetch(calls: RecordedRequest[]): FetchLike {
  return async (input, init = {}) => {
    calls.push({
      init: {
        body: init.body,
        headers: init.headers ?? {},
        method: init.method,
        signal: init.signal,
      },
      input,
    })

    if (input.endsWith("/api/project-secret/bootstrap")) {
      return jsonResponse(fixture.bootstrap.response)
    }

    if (input.endsWith("/api/projects/proj_sdk_fixture/checkout-sessions") && init.method === "POST") {
      const body = JSON.parse(init.body ?? "{}") as { paymentRail?: string }
      if (body.paymentRail === PaymentRail.ZamaPrivate) {
        return jsonResponse(fixture.checkoutSessions.createZamaPrivate.response)
      }
      return jsonResponse(fixture.checkoutSessions.createEvmErc20.response)
    }

    if (input.endsWith("/api/projects/proj_sdk_fixture/checkout-sessions/cs_sdk_evm")) {
      return jsonResponse(fixture.checkoutSessions.createEvmErc20.retrieveResponse)
    }

    return jsonResponse({ error: { message: "not found", type: "api_error" } }, 404)
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = { "x-request-id": "req_fixture" }) {
  return {
    headers,
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}
