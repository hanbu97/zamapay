import { NextResponse } from 'next/server'
import { createPublicClient, http, parseEventLogs, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import { confidentialInvoiceSettlementAbi, localHardhat } from '@/lib/contracts'

type ProjectionRequest = {
  paymentTxHash?: string
}

type PaymentProjectionBody = {
  paymentTxHash: string
  payerAddress: string
}

type ConfirmationBody = {
  confirmations: number
  finalityThreshold: number
}

type ContractManifest = {
  chainId: number | null
  contracts?: {
    ConfidentialInvoiceSettlement?: string
  }
}

const rustApiBaseUrl = process.env.MERMER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'
const contractEnvironment = process.env.NEXT_PUBLIC_CONTRACT_ENV ?? 'local-dev'
const defaultOperatorKey = 'local-operator-dev-key'
const confirmations = Number(process.env.CONFIRMATIONS ?? 2)
const finalityThreshold = Number(process.env.FINALITY_THRESHOLD ?? 2)

class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function isHexHash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function readableError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Payment projection failed.'
}

function routeFailure(caught: unknown) {
  if (caught instanceof RouteError) {
    return NextResponse.json({ error: caught.message }, { status: caught.status })
  }

  return NextResponse.json({ error: readableError(caught) }, { status: 502 })
}

function publicClientForChain(chainId: number | null) {
  if (chainId === sepolia.id) {
    return createPublicClient({
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL),
    })
  }

  return createPublicClient({
    chain: localHardhat,
    transport: http(),
  })
}

function operatorKeyForEnvironment() {
  const configured = process.env.MERMER_OPERATOR_KEY
  if (contractEnvironment === 'sepolia' && (!configured || configured === defaultOperatorKey)) {
    throw new RouteError('MERMER_OPERATOR_KEY must be configured to a non-default value for Sepolia projection.', 500)
  }

  return configured ?? defaultOperatorKey
}

async function rustJson<T>(pathname: string, body: PaymentProjectionBody | ConfirmationBody): Promise<T> {
  const response = await fetch(`${rustApiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': operatorKeyForEnvironment(),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${text}`)
  }

  return JSON.parse(text) as T
}

async function loadSettlementManifest() {
  const response = await fetch(`${rustApiBaseUrl}/api/contracts/${contractEnvironment}`, { cache: 'no-store' })
  const text = await response.text()

  if (!response.ok) {
    throw new RouteError(`Contract manifest lookup failed: ${text}`, 502)
  }

  const manifest = JSON.parse(text) as ContractManifest
  const settlementAddress = manifest.contracts?.ConfidentialInvoiceSettlement
  if (!settlementAddress?.startsWith('0x')) {
    throw new RouteError('ConfidentialInvoiceSettlement is missing from the manifest.', 409)
  }

  return { chainId: manifest.chainId, settlementAddress }
}

async function findInvoicePaidEvent(paymentTxHash: Hex, chainId: number | null, settlementAddress: string) {
  const publicClient = publicClientForChain(chainId)
  const receipt = await publicClient.getTransactionReceipt({ hash: paymentTxHash }).catch(() => null)
  if (!receipt) {
    throw new RouteError('Finalization transaction receipt was not found.', 404)
  }

  if (receipt.status !== 'success') {
    throw new RouteError('Finalization transaction did not succeed.', 409)
  }

  const settlementLogs = receipt.logs.filter((log) => log.address.toLowerCase() === settlementAddress.toLowerCase())
  const paidLogs = parseEventLogs({
    abi: confidentialInvoiceSettlementAbi,
    eventName: 'InvoicePaid',
    logs: settlementLogs,
  })
  const paidLog = paidLogs[0]
  if (!paidLog) {
    throw new RouteError('InvoicePaid event was not emitted by the current settlement contract.', 409)
  }

  return paidLog
}

async function projectPayment(paymentTxHash: Hex, chainInvoiceId: number, payerAddress: string) {
  const projected = await rustJson(`/api/operator/chain-invoices/${chainInvoiceId}/payment-projection`, {
    paymentTxHash,
    payerAddress,
  })
  const finality = await rustJson(`/api/operator/chain-invoices/${chainInvoiceId}/confirmations`, {
    confirmations,
    finalityThreshold,
  })

  return { projected, finality }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ProjectionRequest
  if (!isHexHash(body.paymentTxHash)) {
    return NextResponse.json({ error: 'paymentTxHash must be a 32-byte hex transaction hash.' }, { status: 400 })
  }

  try {
    const { chainId, settlementAddress } = await loadSettlementManifest()
    const paidLog = await findInvoicePaidEvent(body.paymentTxHash, chainId, settlementAddress)
    const chainInvoiceId = Number(paidLog.args.invoiceId)
    const { projected, finality } = await projectPayment(body.paymentTxHash, chainInvoiceId, paidLog.args.payer)

    return NextResponse.json({
      chainId,
      chainInvoiceId,
      paymentTxHash: body.paymentTxHash,
      payerAddress: paidLog.args.payer,
      projected,
      finality,
    })
  } catch (caught) {
    return routeFailure(caught)
  }
}
