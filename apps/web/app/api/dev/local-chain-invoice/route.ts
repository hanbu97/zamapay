import { NextResponse } from 'next/server'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseLocalDevServerBridge } from '@/lib/dev-signer-gate'
import { createLocalChainInvoice } from '@/lib/local-fhevm-dev'

type LocalChainInvoiceRequest = {
  amountMinorUnits?: unknown
  expiresInSeconds?: unknown
  externalRef?: unknown
}

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    canUseLocalDevServerBridge({
      contractEnv: process.env.MERMER_CONTRACT_ENV ?? process.env.NEXT_PUBLIC_CONTRACT_ENV,
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local chain invoice bridge is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as LocalChainInvoiceRequest
  const amountMinorUnits = readPositiveSafeInteger(body.amountMinorUnits)
  const expiresInSeconds =
    body.expiresInSeconds === undefined ? undefined : readPositiveSafeInteger(body.expiresInSeconds)

  if (amountMinorUnits === null) {
    return NextResponse.json({ error: 'amountMinorUnits must be a positive integer.' }, { status: 400 })
  }
  if (body.expiresInSeconds !== undefined && expiresInSeconds === null) {
    return NextResponse.json({ error: 'expiresInSeconds must be a positive integer.' }, { status: 400 })
  }
  if (typeof body.externalRef !== 'string' || !body.externalRef.trim()) {
    return NextResponse.json({ error: 'externalRef is required.' }, { status: 400 })
  }

  try {
    return NextResponse.json(
      await createLocalChainInvoice({
        amountMinorUnits: BigInt(amountMinorUnits),
        expiresInSeconds: expiresInSeconds ?? undefined,
        externalRef: body.externalRef,
      }),
    )
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local chain invoice creation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
