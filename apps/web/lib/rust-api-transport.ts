import { runtimeApiBaseUrl } from './runtime-profile.ts'

type ForwardOptions = {
  contentTypeFallback?: string
  copyCookie?: boolean
  search?: string
}

type JsonOptions = {
  headers?: HeadersInit
}

export class RustApiError extends Error {
  readonly body: string
  readonly pathname: string
  readonly status: number

  constructor(pathname: string, status: number, body: string) {
    super(`${pathname} failed with ${status}: ${body}`)
    this.name = 'RustApiError'
    this.body = body
    this.pathname = pathname
    this.status = status
  }
}

const rustApiBaseUrl = runtimeApiBaseUrl()

export function encodedRustPath(prefix: string, segments: readonly string[]): string {
  const suffix = segments.map(encodeURIComponent).join('/')
  const normalizedPrefix = prefix.replace(/\/$/u, '')

  return suffix ? `${normalizedPrefix}/${suffix}` : normalizedPrefix
}

export function rustApiUrl(pathname: string, search = ''): URL {
  const upstream = new URL(pathname, rustApiBaseUrl)
  upstream.search = search
  return upstream
}

export async function fetchRustFromRequest(
  request: Request,
  pathname: string,
  options: ForwardOptions = {},
): Promise<Response> {
  const upstream = rustApiUrl(pathname, options.search ?? new URL(request.url).search)

  return fetch(upstream, {
    body: bodylessMethod(request.method) ? undefined : await request.text(),
    headers: forwardedHeaders(request, options),
    method: request.method,
  })
}

export async function proxyRustFromRequest(
  request: Request,
  pathname: string,
  options: ForwardOptions = {},
): Promise<Response> {
  return rustTextResponse(await fetchRustFromRequest(request, pathname, options))
}

export async function rustTextResponse(upstream: Response, body?: string): Promise<Response> {
  const text = body ?? (await upstream.text())
  return new Response(text, rustTextResponseInit(upstream))
}

export function rustTextResponseInit(upstream: Response): ResponseInit {
  return {
    headers: {
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
    status: upstream.status,
  }
}

export async function postRustJson<T>(pathname: string, body: unknown, options: JsonOptions = {}): Promise<T> {
  const response = await fetch(rustApiUrl(pathname), {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...options.headers,
    },
    method: 'POST',
  })
  const text = await response.text()

  if (!response.ok) {
    throw new RustApiError(pathname, response.status, text)
  }

  return JSON.parse(text) as T
}

function forwardedHeaders(request: Request, options: ForwardOptions): Headers {
  const headers = new Headers()
  const contentType = request.headers.get('content-type') ?? options.contentTypeFallback
  const cookie = request.headers.get('cookie')

  if (contentType) {
    headers.set('content-type', contentType)
  }
  if (options.copyCookie && cookie) {
    headers.set('cookie', cookie)
  }

  return headers
}

function bodylessMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}
