import { NextRequest, NextResponse } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { publicContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { postRustJson } from '@/lib/rust-api-transport'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'zamapay_session'
const localLoginPrivateKey =
  process.env.ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

type NonceResponse = {
  nonce: string
  message: string
}

type SessionResponse = {
  authenticated?: boolean
  user?: {
    sessionId?: string
  } | null
}

export async function GET(request: NextRequest) {
  if (!canCreateLocalSession(request)) {
    return NextResponse.json({ error: 'local session is available only for local non-production verification.' }, { status: 404 })
  }

  const account = privateKeyToAccount(localLoginPrivateKey as `0x${string}`)
  const challenge = await postRustJson<NonceResponse>('/api/auth/nonce', { address: account.address })
  const signature = await account.signMessage({ message: challenge.message })
  const session = await postRustJson<SessionResponse>('/api/auth/verify', {
    address: account.address,
    message: challenge.message,
    nonce: challenge.nonce,
    signature,
  })
  const sessionId = session.user?.sessionId
  if (session.authenticated !== true || !sessionId) {
    return NextResponse.json({ error: 'Rust auth service did not return a session id.' }, { status: 502 })
  }

  const redirectTo = new URL(safeRedirectPath(request.nextUrl.searchParams.get('next')), request.url)
  const response = NextResponse.redirect(redirectTo)
  response.cookies.set({
    httpOnly: true,
    name: SESSION_COOKIE_NAME,
    path: '/',
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    value: sessionId,
  })

  return response
}

function canCreateLocalSession(request: NextRequest): boolean {
  return canUseDevSigner({
    contractEnv: publicContractEnvironment(),
    enableDevSigner: process.env.ZAMAPAY_ENABLE_DEV_SIGNER,
    nodeEnv: process.env.NODE_ENV,
    requestUrl: request.url,
  })
}

function safeRedirectPath(path: string | null): string {
  if (path?.startsWith('/') && !path.startsWith('//') && !path.startsWith('/api')) {
    return path
  }

  return '/merchant'
}
