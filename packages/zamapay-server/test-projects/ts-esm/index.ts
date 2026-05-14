import assert from "node:assert/strict"
import {
  PaymentRail,
  ZamaPayClient,
  ZamaPayRateLimitError,
  type CheckoutSessionResponse,
  type FetchLike,
  type ZamaPayResponse,
} from "@zamapay/server"

const fetch: FetchLike = async () => ({
  headers: { "x-request-id": "req_install_shape" },
  ok: false,
  status: 429,
  text: async () =>
    JSON.stringify({
      error: {
        code: "rate_limited",
        message: "slow down",
        type: "rate_limit_error",
      },
    }),
})

const client = new ZamaPayClient({
  baseUrl: "https://api.example.test",
  fetch,
  projectId: "proj_install_shape",
  secretKey: "zms_test_install_shape",
})

try {
  await client.checkoutSessions.create({
    amountLabel: "1 USDT",
    amountMinorUnits: 1_000_000,
    evmChainId: 31337,
    evmTokenSymbol: "USDT",
    idempotencyKey: "order_install_ts_esm",
    merchantOrderId: "order_install_ts_esm",
    note: "TS ESM install-shape smoke",
    paymentRail: PaymentRail.EvmErc20,
    title: "TS ESM checkout",
  })
  throw new Error("expected rate limit")
} catch (error) {
  assert(error instanceof ZamaPayRateLimitError)
  assert.equal(error.status, 429)
}

const typedResponse = {
  checkoutUrl: "https://pay.example.test/checkout/cs_install_ts_esm",
  lastResponse: { headers: {}, status: 200 },
} as ZamaPayResponse<CheckoutSessionResponse>
const requestId: string | undefined = typedResponse.lastResponse.requestId
assert.equal(requestId, undefined)
