import type { CardForgeConfig } from '@/lib/config'

export type CheckoutRecord = {
  billing: {
    feeBps: number
    grossAmountMinorUnits: number
    merchantNetMinorUnits: number
    platformFeeMinorUnits: number
    plan: string
  }
  chainInvoiceId: number
  checkoutSessionId: string
  checkoutUrl: string
  invoiceId: string
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

export type ConfidentialWalletSnapshot = {
  accountCommitment?: string
  address: string
  balanceHandle: string
  balanceLabel: string
  balanceMinorUnits: string
  mintedMinorUnits: string
  mintTxHash: string | null
  paymentRailAddress?: string
  tokenAddress: string
}

type ErrorBody = {
  code?: string
  loginUrl?: string
  message?: string
}

export async function getConfidentialWallet(config: CardForgeConfig, address: string) {
  const response = await fetch(`${config.apiBaseUrl}/api/confidential-wallet/${address}`, {
    credentials: 'omit',
    cache: 'no-store',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new CardForgeApiError('wallet_read_failed', body.message ?? `CardForge backend returned ${response.status}.`)
  }

  return response.json() as Promise<ConfidentialWalletSnapshot>
}

export async function createCardForgeCheckout(config: CardForgeConfig) {
  const response = await fetch(`${config.apiBaseUrl}/api/orders/checkout`, {
    method: 'POST',
    credentials: 'omit',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    const code = body.code === 'mermer_project_auth_failed' ? body.code : 'checkout_create_failed'

    throw new CardForgeApiError(code, body.message ?? `CardForge backend returned ${response.status}.`, body.loginUrl)
  }

  return response.json() as Promise<CheckoutRecord>
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
      | 'fulfillment_read_failed'
      | 'mermer_project_auth_failed'
      | 'wallet_read_failed',
    message: string,
    public readonly loginUrl?: string,
  ) {
    super(message)
  }
}
