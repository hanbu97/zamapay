import { proxyRustFromRequest } from '@/lib/rust-api-transport'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return proxyRustFromRequest(request, '/api/auth/nonce', { contentTypeFallback: 'application/json' })
}
