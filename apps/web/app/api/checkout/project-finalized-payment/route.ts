import { NextResponse } from 'next/server'
import { createPublicClient, http, parseEventLogs, type Hex } from 'viem'
import { privateCheckoutSettlementAbi } from '@/lib/contracts'
import { contractEnvironmentConfig, serverContractEnvironment, type ContractEnvironmentConfig } from '@/lib/contract-environment'
import { finalizeLocalPrivatePayment } from '@/lib/local-fhevm-dev'

type ProjectionRequest = {
  chainInvoiceId?: unknown
  paymentTxHash?: string
}

type PaymentProjectionBody = {
  paymentTxHash: string
  payerAddress: string
}

type FinalizedPayment = {
  chainInvoiceId: number
  payerAddress: string
  paymentTxHash: Hex
}

type ActiveSettlement = {
  config: ContractEnvironmentConfig
  settlementAddress: Hex
}

type ConfirmationBody = {
  confirmations: number
  finalityThreshold: number
}

const rustApiBaseUrl = process.env.ZAMAPAY_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'
const operatorKey = process.env.ZAMAPAY_OPERATOR_KEY ?? 'local-operator-dev-key'
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

function publicClient(config: ContractEnvironmentConfig) {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.walletChain.rpcUrls[0]),
  })
}

function activeSettlement(): ActiveSettlement {
  const config = contractEnvironmentConfig(serverContractEnvironment())
  const settlementAddress = config.manifest?.contracts.PrivateCheckoutSettlement
  if (!settlementAddress?.startsWith('0x')) {
    throw new RouteError(`PrivateCheckoutSettlement is missing from the ${config.label} manifest.`, 409)
  }

  return {
    config,
    settlementAddress: settlementAddress as Hex,
  }
}

async function rustJson<T>(pathname: string, body: PaymentProjectionBody | ConfirmationBody): Promise<T> {
  const response = await fetch(`${rustApiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': operatorKey,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${text}`)
  }

  return JSON.parse(text) as T
}

async function findFinalizedPayment(input: {
  active: ActiveSettlement
  paymentTxHash: Hex
  requestedChainInvoiceId?: number | null
}): Promise<FinalizedPayment> {
  const { config, settlementAddress } = input.active
  const client = publicClient(config)
  const receipt = await client.getTransactionReceipt({ hash: input.paymentTxHash }).catch(() => null)
  if (!receipt) {
    throw new RouteError('Finalization transaction receipt was not found.', 404)
  }

  if (receipt.status !== 'success') {
    throw new RouteError('Finalization transaction did not succeed.', 409)
  }

  const settlementLogs = receipt.logs.filter((log) => log.address.toLowerCase() === settlementAddress.toLowerCase())
  const finalizedLogs = parseEventLogs({
    abi: privateCheckoutSettlementAbi,
    eventName: 'PrivatePaymentFinalized',
    logs: settlementLogs,
  })
  const finalizedLog = finalizedLogs[0]
  if (!finalizedLog) {
    throw new RouteError(`PrivatePaymentFinalized event was not emitted by the ${config.label} settlement contract.`, 409)
  }

  if (!finalizedLog.args.accepted) {
    throw new RouteError('PrivatePaymentFinalized was rejected.', 409)
  }

  const chainInvoiceId =
    input.requestedChainInvoiceId ??
    Number(
      await client.readContract({
        address: settlementAddress,
        abi: privateCheckoutSettlementAbi,
        functionName: 'checkoutIdOf',
        args: [finalizedLog.args.orderCommitment],
      }),
    )

  return {
    chainInvoiceId,
    payerAddress: '0x0000000000000000000000000000000000000000',
    paymentTxHash: input.paymentTxHash,
  }
}

async function finalizeSubmittedPayment(chainInvoiceId: number): Promise<FinalizedPayment> {
  const finalized = await finalizeLocalPrivatePayment({ chainInvoiceId })
  if (!finalized.accepted) {
    throw new RouteError('PrivatePaymentFinalized was rejected.', 409)
  }

  return {
    chainInvoiceId: finalized.chainInvoiceId,
    payerAddress: finalized.payerAddress,
    paymentTxHash: finalized.paymentTxHash,
  }
}

async function projectPayment(paymentTxHash: Hex, chainInvoiceId: number, payerAddress: string) {
  const projected = await rustJson(`/api/operator/chain-invoices/${chainInvoiceId}/payment-projection`, {
    paymentTxHash,
    payerAddress,
  })
  projectFinalityInBackground(chainInvoiceId)

  return { projected }
}

function projectFinalityInBackground(chainInvoiceId: number) {
  queueMicrotask(() => {
    void rustJson(`/api/operator/chain-invoices/${chainInvoiceId}/confirmations`, {
      confirmations,
      finalityThreshold,
    }).catch((error) => {
      console.error(`Failed to project finality for chain invoice ${chainInvoiceId}:`, error)
    })
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ProjectionRequest
  const requestedChainInvoiceId =
    typeof body.chainInvoiceId === 'number' && Number.isSafeInteger(body.chainInvoiceId) && body.chainInvoiceId >= 0
      ? body.chainInvoiceId
      : null
  const paymentTxHash = isHexHash(body.paymentTxHash) ? body.paymentTxHash : null

  if (!paymentTxHash && requestedChainInvoiceId === null) {
    return NextResponse.json(
      { error: 'chainInvoiceId or paymentTxHash is required for private checkout projection.' },
      { status: 400 },
    )
  }

  try {
    const active = activeSettlement()
    if (!paymentTxHash && active.config.key !== 'local-dev') {
      throw new RouteError('paymentTxHash is required for Sepolia projection; the browser must finalize with the official Zama public-decrypt proof.', 400)
    }

    const paid = paymentTxHash
      ? await findFinalizedPayment({
          active,
          paymentTxHash,
          requestedChainInvoiceId,
        })
      : await finalizeSubmittedPayment(requestedChainInvoiceId!)
    const { projected } = await projectPayment(paid.paymentTxHash, paid.chainInvoiceId, paid.payerAddress)

    return NextResponse.json({
      chainId: active.config.manifest?.chainId ?? active.config.chain.id,
      chainInvoiceId: paid.chainInvoiceId,
      paymentTxHash: paid.paymentTxHash,
      payerAddress: paid.payerAddress,
      projected,
      finality: null,
    })
  } catch (caught) {
    return routeFailure(caught)
  }
}
