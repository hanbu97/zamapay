import assert from "node:assert/strict"
import {
  PaymentRail,
  ZAMAPAY_API_VERSION_HEADER,
  ZAMAPAY_PREVIEW_API_VERSION,
  ZamaPayClient,
} from "@zamapay/server"
import { verifyWebhook, generateTestHeaders } from "@zamapay/server/webhooks"

const calls = []
const client = new ZamaPayClient({
  baseUrl: "https://api.example.test",
  fetch: async (input, init = {}) => {
    calls.push({ input, init })
    return jsonResponse({
      amountLabel: "120 cUSDT",
      amountMinorUnits: 120_000_000,
      checkoutSessionId: "cs_install_esm",
      checkoutUrl: "https://pay.example.test/checkout/cs_install_esm",
      environment: "local_dev",
      invoiceId: "inv_install_esm",
      merchantOrderId: "order_install_esm",
      merchantOwnerWallet: "0x1111111111111111111111111111111111111111",
      paymentRail: "zama_private",
      projectId: "proj_install_shape",
      status: "open",
    })
  },
  projectId: "proj_install_shape",
  secretKey: "zms_test_install_shape",
})

const session = await client.checkoutSessions.create({
  amountLabel: "120 cUSDT",
  amountMinorUnits: 120_000_000,
  chainInvoiceId: 42,
  chainTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  idempotencyKey: "order_install_esm",
  merchantOrderId: "order_install_esm",
  note: "ESM install-shape smoke",
  paymentRail: PaymentRail.ZamaPrivate,
  title: "ESM checkout",
})

const body = JSON.parse(calls[0].init.body)
assert.equal(calls[0].init.headers[ZAMAPAY_API_VERSION_HEADER], ZAMAPAY_PREVIEW_API_VERSION)
assert.equal(body.paymentRail, "zama_private")
assert.equal(body.evmChainId, undefined)
assert.equal(session.lastResponse.status, 200)

const payload = '{"type":"checkout.paid","checkoutSessionId":"cs_install_esm"}'
assert.equal(
  verifyWebhook(
    payload,
    generateTestHeaders({
      messageId: "msg_install_esm",
      payload,
      secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
      timestamp: 1778767200,
    }),
    {
      nowUnixSeconds: 1778767200,
      secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
    },
  ),
  true,
)

function jsonResponse(body) {
  return {
    headers: { "x-request-id": "req_install_shape" },
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  }
}
