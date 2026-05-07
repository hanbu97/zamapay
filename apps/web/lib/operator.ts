import type { InvoiceRecord } from '@/lib/api'

export type IndexerCursor = {
  indexedInvoices: number
  latestChainInvoiceId?: number | null
  latestPaymentTxHash?: string | null
}

export type OperatorDiagnostics = {
  chainSyncStatus: string
  indexerCursor: IndexerCursor
  indexerStalled: boolean
  pendingDecryptJobs: number
  pendingFinalityBacklog: number
  pendingWebhooks?: number
  retryingWebhooks?: number
  failedWebhooks: number
  expiredInvoices?: number
  operatorAuthRejections?: number
  decryptPendingGuardTrips?: number
  decryptTimeouts: number
  replayGuardFailures: number
  reorgExceptions: number
  frozenFulfillments: number
  releaseFailures: number
  operatorActionRequired: boolean
  invoices: InvoiceRecord[]
}

export type OperatorDiagnosticsResult =
  | {
      diagnostics: OperatorDiagnostics
      status: 'ready'
    }
  | {
      reason: string
      status: 'error' | 'locked'
    }

const apiBaseUrl = process.env.MERMER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'
const contractEnvironment = process.env.NEXT_PUBLIC_CONTRACT_ENV ?? 'local-dev'
const defaultOperatorKey = 'local-operator-dev-key'

function resolveOperatorKey(): OperatorDiagnosticsResult | { key: string } {
  const configured = process.env.MERMER_OPERATOR_KEY

  if (contractEnvironment === 'sepolia' && (!configured || configured === defaultOperatorKey)) {
    return {
      reason: 'Sepolia operator diagnostics require a non-default MERMER_OPERATOR_KEY.',
      status: 'locked',
    }
  }

  return { key: configured ?? defaultOperatorKey }
}

export async function getOperatorDiagnostics(): Promise<OperatorDiagnosticsResult> {
  const operatorKey = resolveOperatorKey()

  if ('status' in operatorKey) {
    return operatorKey
  }

  const response = await fetch(`${apiBaseUrl}/api/operator/diagnostics`, {
    cache: 'no-store',
    headers: {
      'x-operator-key': operatorKey.key,
    },
  })
  const body = await response.text()

  if (!response.ok) {
    return {
      reason: body || `Operator diagnostics failed with ${response.status}.`,
      status: 'error',
    }
  }

  return {
    diagnostics: JSON.parse(body) as OperatorDiagnostics,
    status: 'ready',
  }
}
