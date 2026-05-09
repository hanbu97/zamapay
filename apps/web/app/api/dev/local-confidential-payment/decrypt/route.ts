import { NextResponse } from 'next/server'
import { type Hex } from 'viem'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { publicDecryptLocalBool } from '@/lib/local-fhevm-dev'

type LocalPaymentDecryptRequest = {
  paymentCheckHandle?: unknown
}

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    canUseDevSigner({
      contractEnv: process.env.NEXT_PUBLIC_CONTRACT_ENV,
      enableDevSigner: process.env.MERMER_ENABLE_DEV_SIGNER,
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local confidential payment decrypt bridge is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as LocalPaymentDecryptRequest
  if (!isBytes32(body.paymentCheckHandle)) {
    return NextResponse.json({ error: 'paymentCheckHandle must be a 32-byte hex value.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await publicDecryptLocalBool(body.paymentCheckHandle))
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local confidential payment decrypt failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
