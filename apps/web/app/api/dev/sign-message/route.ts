import { NextResponse } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { canUseDevSigner } from '@/lib/dev-signer-gate'

type SignMessageRequest = {
  message?: unknown
}

const localLoginPrivateKey =
  process.env.MERMER_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function isEnabled(request: Request) {
  return canUseDevSigner({
    contractEnv: process.env.NEXT_PUBLIC_CONTRACT_ENV,
    enableDevSigner: process.env.MERMER_ENABLE_DEV_SIGNER,
    nodeEnv: process.env.NODE_ENV,
    requestUrl: request.url,
  })
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'dev signing is available only for local non-production verification.' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as SignMessageRequest
  if (typeof body.message !== 'string' || body.message.length === 0 || body.message.length > 4096) {
    return NextResponse.json({ error: 'message must be a non-empty string under 4096 characters.' }, { status: 400 })
  }

  const account = privateKeyToAccount(localLoginPrivateKey as `0x${string}`)
  const signature = await account.signMessage({ message: body.message })

  return NextResponse.json(
    {
      address: account.address,
      signature,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
