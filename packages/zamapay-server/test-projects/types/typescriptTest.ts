import {
  PaymentRail,
  ZamaPayClient,
  type CheckoutSessionResponse,
  type CreateCheckoutSessionInput,
  type ZamaPayResponse,
} from "@zamapay/server"
import { constructWebhookEvent, generateTestHeaders } from "@zamapay/server/webhooks"

const evmCheckout: CreateCheckoutSessionInput = {
  amountLabel: "1 USDT",
  amountMinorUnits: 1_000_000,
  evmChainId: 31337,
  evmTokenSymbol: "USDT",
  idempotencyKey: "order_types_evm",
  merchantOrderId: "order_types_evm",
  note: "types rail check",
  paymentRail: PaymentRail.EvmErc20,
  title: "Types ERC20 checkout",
}

const privateCheckout: CreateCheckoutSessionInput = {
  amountLabel: "120 cUSDT",
  amountMinorUnits: 120_000_000,
  chainInvoiceId: 42,
  chainTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  idempotencyKey: "order_types_private",
  merchantOrderId: "order_types_private",
  note: "types private rail check",
  paymentRail: PaymentRail.ZamaPrivate,
  title: "Types private checkout",
}

const client = new ZamaPayClient({
  baseUrl: "https://api.example.test",
  secretKey: "zms_test_install_shape",
})

client.checkoutSessions.create(evmCheckout)
client.checkoutSessions.create(privateCheckout)

const response = {} as ZamaPayResponse<CheckoutSessionResponse>
const status: number = response.lastResponse.status
const checkoutUrl: string = response.checkoutUrl

const headers = generateTestHeaders({
  payload: '{"type":"checkout.paid"}',
  secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
})
const event = constructWebhookEvent<{ type: string }>('{"type":"checkout.paid"}', headers, {
  secret: "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ",
})
const webhookType: string = event.type

// @ts-expect-error chain invoice fields do not belong to evm_erc20 input.
const badEvmCheckout: CreateCheckoutSessionInput = {
  ...evmCheckout,
  chainInvoiceId: 42,
}

// @ts-expect-error evm token fields do not belong to zama_private input.
const badPrivateCheckout: CreateCheckoutSessionInput = {
  ...privateCheckout,
  evmTokenSymbol: "USDT",
}

void status
void checkoutUrl
void webhookType
void badEvmCheckout
void badPrivateCheckout
