import type { CardForgeConfig } from '@/lib/config'

export type CheckoutRecord = {
  chainInvoiceId: number
  checkoutSessionId: string
  checkoutUrl: string
  invoiceId: string
}

type ErrorBody = {
  code?: string
  loginUrl?: string
  message?: string
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

async function readErrorBody(response: Response): Promise<ErrorBody> {
  const text = await response.text()

  try {
    return JSON.parse(text) as ErrorBody
  } catch {
    return { message: text }
  }
}

export class CardForgeApiError extends Error {
  constructor(
    public readonly code: 'checkout_create_failed' | 'mermer_project_auth_failed',
    message: string,
    public readonly loginUrl?: string,
  ) {
    super(message)
  }
}
