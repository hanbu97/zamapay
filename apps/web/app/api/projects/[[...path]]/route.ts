import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const rustApiBaseUrl = process.env.ZAMAPAY_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'

type RouteContext = {
  params: Promise<{
    path?: string[]
  }>
}

export async function GET(request: Request, context: RouteContext) {
  return proxyRustRequest(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRustRequest(request, context)
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyRustRequest(request, context)
}

async function proxyRustRequest(request: Request, context: RouteContext) {
  const { path = [] } = await context.params
  const url = new URL(request.url)
  const suffix = path.map(encodeURIComponent).join('/')
  const upstream = new URL(suffix ? `/api/projects/${suffix}` : '/api/projects', rustApiBaseUrl)
  upstream.search = url.search

  return forward(request, upstream)
}

async function forward(request: Request, upstream: URL) {
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  const cookie = request.headers.get('cookie')
  if (contentType) {
    headers.set('content-type', contentType)
  }
  if (cookie) {
    headers.set('cookie', cookie)
  }

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
  })

  return new NextResponse(await response.text(), {
    headers: {
      'cache-control': 'no-store',
      'content-type': response.headers.get('content-type') ?? 'application/json',
    },
    status: response.status,
  })
}
