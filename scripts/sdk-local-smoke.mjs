#!/usr/bin/env node
import { PaymentRail, ZamaPayClient } from "../packages/zamapay-server/src/index.ts"

const apiUrl = process.env.ZAMAPAY_API_URL ?? process.env.ZAMAPAY_API_BASE_URL ?? "http://127.0.0.1:18080"
const secretKey = process.env.ZAMAPAY_SECRET_KEY

if (!secretKey || secretKey.includes("replace_with_console_value")) {
  throw new Error("ZAMAPAY_SECRET_KEY must be set to a real project secret before running SDK smoke")
}

const client = new ZamaPayClient({
  baseUrl: apiUrl,
  secretKey,
})

const bootstrap = await client.bootstrapProject()
console.log(`[sdk-smoke] bootstrapped project ${bootstrap.projectId} (${bootstrap.environment})`)

const orderId = `sdk_smoke_${Date.now()}`
const checkout = await client.checkoutSessions.create({
  amountLabel: "1 USDT",
  amountMinorUnits: 1_000_000,
  cancelUrl: `${apiUrl}/sdk-smoke/cancel`,
  evmChainId: 31337,
  evmTokenSymbol: "USDT",
  idempotencyKey: orderId,
  merchantOrderId: orderId,
  metadata: {
    source: "sdk-local-smoke",
  },
  note: "ZamaPay server SDK local smoke",
  paymentRail: PaymentRail.EvmErc20,
  successUrl: `${apiUrl}/sdk-smoke/success`,
  title: "SDK local smoke",
})

console.log(`[sdk-smoke] created ${checkout.checkoutSessionId} via ${checkout.paymentRail}`)

const retrieved = await client.checkoutSessions.retrieve(checkout.checkoutSessionId)
if (retrieved.checkoutSessionId !== checkout.checkoutSessionId) {
  throw new Error(`retrieved checkout mismatch: expected ${checkout.checkoutSessionId}, got ${retrieved.checkoutSessionId}`)
}

console.log(`[sdk-smoke] retrieved ${retrieved.checkoutSessionId} with status ${retrieved.status}`)
