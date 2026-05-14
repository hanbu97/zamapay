import {
  apiErrorFromResponse,
  ZamaPayApiError,
  ZamaPayConnectionError,
  ZamaPayInvalidRequestError,
  ZamaPayTimeoutError,
} from "./errors.ts"

export const DEFAULT_ZAMAPAY_API_BASE_URL = "https://api.zamapay.org"
export const ZAMAPAY_API_VERSION_HEADER = "ZamaPay-Version"
export const ZAMAPAY_PREVIEW_API_VERSION = "2026-05-14"
export const ZAMAPAY_SERVER_SDK_VERSION = "0.1.0-preview.0"

const DEFAULT_TIMEOUT_MS = 80_000
const DEFAULT_MAX_NETWORK_RETRIES = 1
const REQUEST_ID_HEADERS = ["request-id", "x-request-id", "zamapay-request-id"]

export type FetchResponseHeaders =
  | Record<string, string | string[] | undefined>
  | {
      forEach?(callback: (value: string, key: string) => void): void
      get(name: string): string | null
    }

export type FetchResponse = {
  headers?: FetchResponseHeaders
  ok: boolean
  status: number
  text(): Promise<string>
}

export type FetchLike = (
  input: string,
  init?: {
    body?: string
    headers?: Record<string, string>
    method?: string
    signal?: AbortSignal
  },
) => Promise<FetchResponse>

export type ZamaPayLastResponse = {
  apiVersion: string
  headers: Record<string, string>
  idempotencyKey?: string
  requestId?: string
  status: number
}

export type ZamaPayResponse<T> = T & {
  readonly lastResponse: ZamaPayLastResponse
}

export type ZamaPayRequestSenderOptions = {
  apiVersion?: string
  baseUrl?: string
  fetch?: FetchLike
  maxNetworkRetries?: number
  secretKey: string
  timeoutMs?: number
}

export type ZamaPayRequestOptions = {
  body?: unknown
  idempotencyKey?: string
  maxNetworkRetries?: number
  timeoutMs?: number
}

export class ZamaPayRequestSender {
  readonly apiVersion: string
  readonly baseUrl: string
  readonly maxNetworkRetries: number
  readonly timeoutMs: number

  private readonly fetchImpl: FetchLike
  private readonly secretKey: string

  constructor(options: ZamaPayRequestSenderOptions) {
    if (!options.secretKey || !options.secretKey.trim()) {
      throw new ZamaPayInvalidRequestError("ZamaPay secretKey is required", {
        code: "missing_secret_key",
      })
    }

    this.apiVersion = options.apiVersion ?? ZAMAPAY_PREVIEW_API_VERSION
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_ZAMAPAY_API_BASE_URL)
    this.fetchImpl = options.fetch ?? defaultFetch()
    this.maxNetworkRetries = normalizeRetryCount(options.maxNetworkRetries)
    this.secretKey = options.secretKey
    this.timeoutMs = normalizeTimeout(options.timeoutMs)
  }

  async request<T>(method: string, path: string, options: ZamaPayRequestOptions = {}): Promise<ZamaPayResponse<T>> {
    const upperMethod = method.toUpperCase()
    const maxNetworkRetries = normalizeRetryCount(options.maxNetworkRetries ?? this.maxNetworkRetries)
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.timeoutMs)
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers = this.requestHeaders(body !== undefined, options.idempotencyKey)
    const retryable = requestCanRetry(upperMethod, options.idempotencyKey)
    const url = `${this.baseUrl}${path}`

    let attempt = 0
    while (true) {
      try {
        const response = await this.fetchWithTimeout(url, { body, headers, method: upperMethod }, timeoutMs)
        const responseHeaders = headersToRecord(response.headers)
        const rawBody = await response.text()
        const lastResponse = lastResponseFrom({
          apiVersion: this.apiVersion,
          headers: responseHeaders,
          idempotencyKey: options.idempotencyKey,
          status: response.status,
        })

        if (retryable && attempt < maxNetworkRetries && responseShouldRetry(response.status)) {
          await sleep(retryDelayMillis(attempt, responseHeaders))
          attempt += 1
          continue
        }

        if (!response.ok) {
          throw apiErrorFromResponse({
            headers: responseHeaders,
            rawBody,
            requestId: lastResponse.requestId,
            status: response.status,
          })
        }

        return attachLastResponse(parseJsonResponse<T>(rawBody, response.status, responseHeaders), lastResponse)
      } catch (error) {
        if (!isNetworkError(error)) {
          throw error
        }

        if (retryable && attempt < maxNetworkRetries) {
          await sleep(retryDelayMillis(attempt))
          attempt += 1
          continue
        }

        throw normalizeNetworkError(error)
      }
    }
  }

  private requestHeaders(hasBody: boolean, idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.secretKey}`,
      "User-Agent": `ZamaPay/${ZAMAPAY_SERVER_SDK_VERSION}`,
      [ZAMAPAY_API_VERSION_HEADER]: this.apiVersion,
    }

    if (hasBody) {
      headers["content-type"] = "application/json"
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey
    }

    return headers
  }

  private async fetchWithTimeout(
    url: string,
    init: { body?: string; headers: Record<string, string>; method: string },
    timeoutMs: number,
  ): Promise<FetchResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ZamaPayTimeoutError(`ZamaPay API request timed out after ${timeoutMs}ms`, {
          code: "request_timeout",
        })
      }

      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "")
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new ZamaPayInvalidRequestError("ZamaPay baseUrl must be an absolute URL", {
      code: "invalid_base_url",
    })
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ZamaPayInvalidRequestError("ZamaPay baseUrl must use http or https", {
      code: "invalid_base_url",
    })
  }

  return normalized
}

export function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== "function") {
    throw new ZamaPayInvalidRequestError("global fetch is not available; pass fetch in ZamaPayClient options", {
      code: "missing_fetch",
    })
  }

  return globalThis.fetch as unknown as FetchLike
}

function attachLastResponse<T>(data: T, lastResponse: ZamaPayLastResponse): ZamaPayResponse<T> {
  if (data !== null && typeof data === "object") {
    Object.defineProperty(data, "lastResponse", {
      configurable: true,
      enumerable: false,
      value: lastResponse,
    })
  }

  return data as ZamaPayResponse<T>
}

function parseJsonResponse<T>(rawBody: string, status: number, headers: Record<string, string>): T {
  if (!rawBody) {
    return undefined as T
  }

  try {
    return JSON.parse(rawBody) as T
  } catch {
    throw new ZamaPayApiError("ZamaPay API returned invalid JSON", {
      headers,
      rawBody,
      requestId: requestIdFrom(headers),
      status,
      type: "api_error",
    })
  }
}

function lastResponseFrom(input: {
  apiVersion: string
  headers: Record<string, string>
  idempotencyKey?: string
  status: number
}): ZamaPayLastResponse {
  return {
    ...input,
    requestId: requestIdFrom(input.headers),
  }
}

function headersToRecord(headers?: FetchResponseHeaders): Record<string, string> {
  if (!headers) {
    return {}
  }

  if ("forEach" in headers && typeof headers.forEach === "function") {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
      record[key.toLowerCase()] = value
    })
    return record
  }

  if ("get" in headers && typeof headers.get === "function") {
    const record: Record<string, string> = {}
    for (const name of [...REQUEST_ID_HEADERS, "retry-after"]) {
      const value = headers.get(name)
      if (value) {
        record[name] = value
      }
    }
    return record
  }

  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }
    record[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value
  }
  return record
}

function requestIdFrom(headers: Record<string, string>): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers[name]
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeRetryCount(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_NETWORK_RETRIES
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ZamaPayInvalidRequestError("maxNetworkRetries must be a non-negative integer", {
      code: "invalid_max_network_retries",
    })
  }
  return Math.min(value, 5)
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new ZamaPayInvalidRequestError("timeoutMs must be greater than zero", {
      code: "invalid_timeout",
    })
  }
  return value
}

function requestCanRetry(method: string, idempotencyKey?: string): boolean {
  return method === "GET" || method === "HEAD" || Boolean(idempotencyKey)
}

function responseShouldRetry(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

function retryDelayMillis(attempt: number, headers: Record<string, string> = {}): number {
  const retryAfter = parseRetryAfter(headers["retry-after"])
  if (retryAfter !== undefined) {
    return retryAfter
  }

  return Math.min(100 * 2 ** attempt, 1_000)
}

function parseRetryAfter(value?: string): number | undefined {
  if (!value) {
    return undefined
  }

  const seconds = Number(value)
  if (Number.isFinite(seconds)) {
    return clampRetryAfter(seconds * 1_000)
  }

  const retryAt = Date.parse(value)
  if (Number.isNaN(retryAt)) {
    return undefined
  }

  return clampRetryAfter(retryAt - Date.now())
}

function clampRetryAfter(value: number): number {
  return Math.max(0, Math.min(value, 60_000))
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isNetworkError(error: unknown): boolean {
  return error instanceof ZamaPayConnectionError || error instanceof TypeError || isAbortError(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function normalizeNetworkError(error: unknown): ZamaPayConnectionError {
  if (error instanceof ZamaPayConnectionError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)
  return new ZamaPayConnectionError(`ZamaPay API connection failed: ${message}`, {
    code: "connection_error",
  })
}
