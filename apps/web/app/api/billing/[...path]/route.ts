import { encodedRustPath, proxyRustFromRequest } from '@/lib/rust-api-transport'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    path: string[]
  }>
}

export async function GET(request: Request, context: RouteContext) {
  return proxyRustRequest(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyRustRequest(request, context)
}

async function proxyRustRequest(request: Request, context: RouteContext) {
  const { path } = await context.params
  return proxyRustFromRequest(request, encodedRustPath('/api/billing', path), { copyCookie: true })
}
