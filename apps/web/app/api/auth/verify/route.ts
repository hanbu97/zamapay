import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'zamapay_session'
const rustApiBaseUrl = process.env.ZAMAPAY_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'

type SessionResponse = {
  authenticated?: unknown
  user?: {
    sessionId?: unknown
  } | null
}

export async function POST(request: Request) {
  const body = await request.text()
  const upstream = await fetch(`${rustApiBaseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
    },
    body,
  })
  const text = await upstream.text()

  if (!upstream.ok) {
    return forwardedResponse(upstream, text)
  }

  const session = readSessionResponse(text)
  const sessionId = session.user?.sessionId
  if (session.authenticated !== true || typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'Rust auth service did not return a session id.' }, { status: 502 })
  }

  const response = forwardedResponse(upstream, text)
  response.cookies.set({
    httpOnly: true,
    name: SESSION_COOKIE_NAME,
    path: '/',
    sameSite: 'lax',
    secure: isSecureRequest(request),
    value: sessionId,
  })

  return response
}

function forwardedResponse(upstream: Response, body: string) {
  return new NextResponse(body, {
    headers: {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
    status: upstream.status,
  })
}

function readSessionResponse(body: string): SessionResponse {
  try {
    return JSON.parse(body) as SessionResponse
  } catch {
    return {}
  }
}

function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === 'https:'
}
