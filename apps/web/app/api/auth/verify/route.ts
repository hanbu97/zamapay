import { NextResponse } from 'next/server'
import { fetchRustFromRequest, rustTextResponse, rustTextResponseInit } from '@/lib/rust-api-transport'

export const runtime = 'nodejs'

const SESSION_COOKIE_NAME = 'zamapay_session'

type SessionResponse = {
  authenticated?: unknown
  user?: {
    sessionId?: unknown
  } | null
}

export async function POST(request: Request) {
  const upstream = await fetchRustFromRequest(request, '/api/auth/verify', { contentTypeFallback: 'application/json' })
  const text = await upstream.text()

  if (!upstream.ok) {
    return rustTextResponse(upstream, text)
  }

  const session = readSessionResponse(text)
  const sessionId = session.user?.sessionId
  if (session.authenticated !== true || typeof sessionId !== 'string' || !sessionId) {
    return NextResponse.json({ error: 'Rust auth service did not return a session id.' }, { status: 502 })
  }

  const response = new NextResponse(text, rustTextResponseInit(upstream))
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
