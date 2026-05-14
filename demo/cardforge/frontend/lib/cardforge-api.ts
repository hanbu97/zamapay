import type { CardForgeConfig } from '@/lib/config'

export type CheckoutRecord = {
  billing: {
    feeBps: number
    grossAmountMinorUnits: number
    merchantNetMinorUnits: number
    platformFeeMinorUnits: number
    plan: string
  }
  chainInvoiceId: null | number
  checkoutSessionId: string
  checkoutUrl: string
  invoiceId: string
  paymentRail: 'evm_erc20' | 'zama_private'
}

export type FulfillmentSnapshot = {
  cards: Array<{
    label: string
    secret: string
  }>
  latestRelease: null | {
    amountLabel: null | string
    checkoutSessionId: string
    invoiceId: string
  }
  released: boolean
  releasedCount: number
}

export type WebhookReceipt = {
  id: null | string
  payload: {
    amountLabel?: string
    amountMinorUnits?: number
    chainInvoiceId?: null | number
    chainTxHash?: null | string
    checkoutSessionId?: string
    createdAt?: string
    event?: string
    finalityStatus?: string
    fulfillmentStatus?: string
    invoiceId?: string
    paymentTruth?: string
    paymentTxHash?: null | string
  } & Record<string, unknown>
  signature: null | string
}

export type WebhookLog = {
  events: WebhookReceipt[]
  receivedEventCount: number
}

export type OwnedCardRecord = {
  amountLabel: string
  amountMinorUnits: number
  cards: Array<{
    label: string
    secret: string
  }>
  chainInvoiceId: null | number
  checkoutSessionId: string
  id: string
  invoiceId: string
  paymentTxHash: null | string
  productId: string
  purchasedAt: string
  title: string
  walletAddress: string
}

export type PaymentActivityRecord = {
  amountLabel: string
  amountMinorUnits: string
  chainId: number
  chainInvoiceId: number | null
  checkoutSessionId: string | null
  recordedAt: string
  status: 'confirmed'
  txHash: string
  type: 'payment'
}

export type WalletActivityResponse = {
  ownedCards: OwnedCardRecord[]
  payments: PaymentActivityRecord[]
}

type ErrorBody = {
  code?: string
  loginUrl?: string
  message?: string
}

export async function createCardForgeCheckout(
  config: CardForgeConfig,
  productId = 'mythic-loadout',
  buyerWalletAddress?: null | string,
) {
  const response = await fetch(`${config.apiBaseUrl}/api/orders/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...(buyerWalletAddress ? { buyerWalletAddress } : {}),
      productId,
    }),
    credentials: 'omit',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    const code =
      body.code === 'zamapay_project_auth_failed' || body.code === 'unknown_product' ? body.code : 'checkout_create_failed'

    throw new CardForgeApiError(code, body.message ?? `CardForge backend returned ${response.status}.`, body.loginUrl)
  }

  return response.json() as Promise<CheckoutRecord>
}

export async function prepareCardForgeCheckout(config: CardForgeConfig, productId = 'mythic-loadout') {
  const response = await fetch(`${config.apiBaseUrl}/api/orders/prepare-checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ productId }),
    credentials: 'omit',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new CardForgeApiError(
      'checkout_prepare_failed',
      body.message ?? `CardForge backend returned ${response.status}.`,
      body.loginUrl,
    )
  }
}

export async function getCardForgeFulfillment(config: CardForgeConfig) {
  const response = await fetch(`${config.apiBaseUrl}/api/fulfillment`, {
    credentials: 'omit',
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new CardForgeApiError('fulfillment_read_failed', body.message ?? `CardForge backend returned ${response.status}.`)
  }

  return response.json() as Promise<FulfillmentSnapshot>
}

export async function getCardForgeWebhookLog(config: CardForgeConfig) {
  const response = await fetch(`${config.apiBaseUrl}/api/zamapay/webhooks`, {
    credentials: 'omit',
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new CardForgeApiError('webhook_log_read_failed', body.message ?? `CardForge backend returned ${response.status}.`)
  }

  return response.json() as Promise<WebhookLog>
}

export async function getCardForgeWalletActivity(config: CardForgeConfig, walletAddress: string) {
  const response = await fetch(`${config.apiBaseUrl}/api/wallets/${encodeURIComponent(walletAddress)}/activity`, {
    credentials: 'omit',
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new CardForgeApiError(
      'wallet_activity_read_failed',
      body.message ?? `CardForge backend returned ${response.status}.`,
    )
  }

  return response.json() as Promise<WalletActivityResponse>
}

async function readErrorBody(response: Response): Promise<ErrorBody> {
  const text = await response.text()

  try {
    const body = JSON.parse(text) as ErrorBody
    return body.message ? { ...body, message: cleanNestedError(body.message) } : body
  } catch {
    return { message: cleanNestedError(text) }
  }
}

function cleanNestedError(message: string): string {
  try {
    const parsed = JSON.parse(message) as { error?: unknown; message?: unknown }
    const nested = parsed.error ?? parsed.message
    return typeof nested === 'string' ? nested : message
  } catch {
    return message
  }
}

export class CardForgeApiError extends Error {
  constructor(
    public readonly code:
      | 'checkout_create_failed'
      | 'checkout_prepare_failed'
      | 'fulfillment_read_failed'
      | 'zamapay_project_auth_failed'
      | 'webhook_log_read_failed'
      | 'wallet_activity_read_failed'
      | 'unknown_product',
    message: string,
    public readonly loginUrl?: string,
  ) {
    super(message)
  }
}
