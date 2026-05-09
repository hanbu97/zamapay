import { NextResponse } from 'next/server'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { readLocalConfidentialWallet } from '@/lib/local-fhevm-dev'

const fundedBalanceTarget = 1_000_000_000n

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

export async function GET(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local confidential wallet is disabled' }, { status: 404 })
  }

  const url = new URL(request.url)
  const address = url.searchParams.get('address')
  const ensureTargetMinorUnits = url.searchParams.get('ensure') === '1' ? fundedBalanceTarget : undefined

  if (!address) {
    return NextResponse.json({ error: 'address is required.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await readLocalConfidentialWallet({ address, ensureTargetMinorUnits }))
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local confidential wallet lookup failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
