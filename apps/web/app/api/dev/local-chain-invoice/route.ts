import { NextResponse } from 'next/server'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseLocalDevServerBridge, isLocalRequestUrl } from '@/lib/dev-signer-gate'
import { createLocalChainInvoice } from '@/lib/local-fhevm-dev'
import { createSepoliaChainInvoice } from '@/lib/sepolia-fhevm-server'

export const runtime = 'nodejs'

type LocalChainInvoiceRequest = {
  amountMinorUnits?: unknown
  expiresInSeconds?: unknown
  externalRef?: unknown
  merchantNetMinorUnits?: unknown
  merchantOwnerAddress?: unknown
  platformFeeMinorUnits?: unknown
  settlementBucketSeed?: unknown
}

function isLocalDevEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    canUseLocalDevServerBridge({
      contractEnv: process.env.ZAMAPAY_CONTRACT_ENV ?? process.env.NEXT_PUBLIC_CONTRACT_ENV,
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function isSepoliaDevBridgeEnabled(request: Request) {
  return process.env.NODE_ENV !== 'production' && isLocalRequestUrl(request.url)
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function readNonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export async function POST(request: Request) {
  const contractEnvironment = serverContractEnvironment()
  if (contractEnvironment === 'local-dev' && !isLocalDevEnabled(request)) {
    return NextResponse.json({ error: 'local chain invoice bridge is disabled' }, { status: 404 })
  }
  if (contractEnvironment === 'sepolia' && !isSepoliaDevBridgeEnabled(request)) {
    return NextResponse.json({ error: 'sepolia chain invoice bridge is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as LocalChainInvoiceRequest
  const amountMinorUnits = readPositiveSafeInteger(body.amountMinorUnits)
  const merchantNetMinorUnits = readPositiveSafeInteger(body.merchantNetMinorUnits)
  const platformFeeMinorUnits = readNonNegativeSafeInteger(body.platformFeeMinorUnits)
  const expiresInSeconds =
    body.expiresInSeconds === undefined ? undefined : readPositiveSafeInteger(body.expiresInSeconds)

  if (amountMinorUnits === null) {
    return NextResponse.json({ error: 'amountMinorUnits must be a positive integer.' }, { status: 400 })
  }
  if (merchantNetMinorUnits === null) {
    return NextResponse.json({ error: 'merchantNetMinorUnits must be a positive integer.' }, { status: 400 })
  }
  if (platformFeeMinorUnits === null) {
    return NextResponse.json({ error: 'platformFeeMinorUnits must be a non-negative integer.' }, { status: 400 })
  }
  if (merchantNetMinorUnits + platformFeeMinorUnits !== amountMinorUnits) {
    return NextResponse.json({ error: 'billing split must equal amountMinorUnits.' }, { status: 400 })
  }
  if (body.expiresInSeconds !== undefined && expiresInSeconds === null) {
    return NextResponse.json({ error: 'expiresInSeconds must be a positive integer.' }, { status: 400 })
  }
  if (typeof body.externalRef !== 'string' || !body.externalRef.trim()) {
    return NextResponse.json({ error: 'externalRef is required.' }, { status: 400 })
  }
  if (typeof body.settlementBucketSeed !== 'string' || !body.settlementBucketSeed.trim()) {
    return NextResponse.json({ error: 'settlementBucketSeed is required.' }, { status: 400 })
  }
  if (typeof body.merchantOwnerAddress !== 'string' || !body.merchantOwnerAddress.trim()) {
    return NextResponse.json({ error: 'merchantOwnerAddress is required.' }, { status: 400 })
  }

  try {
    const invoiceInput = {
      amountMinorUnits: BigInt(amountMinorUnits),
      expiresInSeconds: expiresInSeconds ?? undefined,
      externalRef: body.externalRef,
      merchantNetMinorUnits: BigInt(merchantNetMinorUnits),
      merchantOwnerAddress: body.merchantOwnerAddress,
      platformFeeMinorUnits: BigInt(platformFeeMinorUnits),
      settlementBucketSeed: body.settlementBucketSeed,
    }

    return NextResponse.json(
      contractEnvironment === 'local-dev'
        ? await createLocalChainInvoice(invoiceInput)
        : await createSepoliaChainInvoice(invoiceInput),
    )
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'chain invoice creation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
