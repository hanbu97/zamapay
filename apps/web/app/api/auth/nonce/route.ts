import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const rustApiBaseUrl = process.env.ZAMAPAY_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'

export async function POST(request: Request) {
  const body = await request.text()
  const response = await fetch(`${rustApiBaseUrl}/api/auth/nonce`, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
    },
    body,
  })

  return new NextResponse(await response.text(), {
    headers: {
      'cache-control': 'no-store',
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
    status: response.status,
  })
}
