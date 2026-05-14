const assert = require("node:assert/strict")
const {
  PaymentRail,
  ZamaPayClient,
  ZamaPayInvalidRequestError,
  generateTestHeaders,
} = require("@zamapay/server")
const { constructWebhookEvent } = require("@zamapay/server/webhooks")

const calls = []
const client = new ZamaPayClient({
  baseUrl: "https://api.example.test/",
  fetch: async (input, init = {}) => {
    calls.push({ input, init })
    return jsonResponse({
      amountLabel: "1 USDT",
      amountMinorUnits: 1_000_000,
      checkoutSessionId: "cs_install_cjs",
      checkoutUrl: "https://pay.example.test/checkout/cs_install_cjs",
      environment: "local_dev",
      invoiceId: "inv_install_cjs",
      merchantOrderId: "order_install_cjs",
      merchantOwnerWallet: "0x1111111111111111111111111111111111111111",
      paymentIntentId: "epi_install_cjs",
      paymentRail: "evm_erc20",
      projectId: "proj_install_shape",
      status: "open",
    })
  },
  projectId: "proj_install_shape",
  secretKey: "zms_test_install_shape",
})

async function main() {
  const session = await client.checkoutSessions.create({
    amountLabel: "1 USDT",
    amountMinorUnits: 1_000_000,
    evmChainId: 31337,
    evmTokenSymbol: "USDT",
    idempotencyKey: "order_install_cjs",
    merchantOrderId: "order_install_cjs",
    note: "CJS install-shape smoke",
    paymentRail: PaymentRail.EvmErc20,
    title: "CJS checkout",
  })

  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].input, "https://api.example.test/api/projects/proj_install_shape/checkout-sessions")
  assert.equal(calls[0].init.headers.Authorization, "Bearer zms_test_install_shape")
  assert.equal(body.paymentRail, "evm_erc20")
  assert.equal(body.chainInvoiceId, undefined)
  assert.equal(session.lastResponse.requestId, "req_install_shape")

  await assert.rejects(
    () =>
      client.checkoutSessions.create({
        amountLabel: "1 USDT",
        amountMinorUnits: 1_000_000,
        chainInvoiceId: 1,
        evmChainId: 31337,
        evmTokenSymbol: "USDT",
        idempotencyKey: "bad_install_cjs",
        merchantOrderId: "bad_install_cjs",
        note: "bad rail",
        paymentRail: PaymentRail.EvmErc20,
        title: "bad checkout",
      }),
    ZamaPayInvalidRequestError,
  )

  const payload = '{"type":"checkout.paid","checkoutSessionId":"cs_install_cjs"}'
  const headers = generateTestHeaders({
    messageId: "msg_install_cjs",
    payload,
    secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
    timestamp: 1778767200,
  })
  const event = constructWebhookEvent(payload, headers, {
    nowUnixSeconds: 1778767200,
    secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
  })
  assert.equal(event.checkoutSessionId, "cs_install_cjs")
}

function jsonResponse(body) {
  return {
    headers: { "x-request-id": "req_install_shape" },
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }
}

main()
