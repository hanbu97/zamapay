export type ZamaPayErrorOptions = {
  code?: string
  headers?: Record<string, string>
  rawBody?: string
  requestId?: string
  status?: number
  type?: string
}

export class ZamaPayError extends Error {
  static readonly errorName: string = "ZamaPayError"

  readonly code?: string
  readonly headers?: Record<string, string>
  readonly rawBody?: string
  readonly requestId?: string
  readonly status?: number
  readonly type?: string

  constructor(message: string, options: ZamaPayErrorOptions = {}) {
    super(message)
    this.name = (new.target as typeof ZamaPayError).errorName
    this.code = options.code
    this.headers = options.headers
    this.rawBody = options.rawBody
    this.requestId = options.requestId
    this.status = options.status
    this.type = options.type
  }
}

export class ZamaPayAuthenticationError extends ZamaPayError {
  static readonly errorName: string = "ZamaPayAuthenticationError"
}

export class ZamaPayApiError extends ZamaPayError {
  static readonly errorName: string = "ZamaPayApiError"
}

export class ZamaPayInvalidRequestError extends ZamaPayApiError {
  static readonly errorName: string = "ZamaPayInvalidRequestError"
}

export class ZamaPayIdempotencyError extends ZamaPayApiError {
  static readonly errorName: string = "ZamaPayIdempotencyError"
}

export class ZamaPayPermissionError extends ZamaPayApiError {
  static readonly errorName: string = "ZamaPayPermissionError"
}

export class ZamaPayRateLimitError extends ZamaPayApiError {
  static readonly errorName: string = "ZamaPayRateLimitError"
}

export class ZamaPayConnectionError extends ZamaPayError {
  static readonly errorName: string = "ZamaPayConnectionError"
}

export class ZamaPayTimeoutError extends ZamaPayConnectionError {
  static readonly errorName: string = "ZamaPayTimeoutError"
}

export class ZamaPayWebhookVerificationError extends ZamaPayError {
  static readonly errorName: string = "ZamaPayWebhookVerificationError"
}

export type ZamaPayApiErrorResponse = {
  headers?: Record<string, string>
  rawBody: string
  requestId?: string
  status: number
}

export function apiErrorFromResponse(response: ZamaPayApiErrorResponse): ZamaPayError {
  const { headers, rawBody, requestId, status } = response
  const parsed = parseError(rawBody)
  const message = parsed.message ?? (rawBody.trim() || `ZamaPay API request failed with ${status}`)
  const options = {
    code: parsed.code,
    headers,
    rawBody,
    requestId,
    status,
    type: parsed.type,
  }

  if (status === 401 || parsed.type === "authentication_error") {
    return new ZamaPayAuthenticationError(message, options)
  }
  if (status === 403 || parsed.type === "permission_error") {
    return new ZamaPayPermissionError(message, options)
  }
  if (status === 429 || parsed.type === "rate_limit_error") {
    return new ZamaPayRateLimitError(message, options)
  }
  if (
    parsed.type === "idempotency_error" ||
    parsed.code === "idempotency_key_reused" ||
    parsed.code?.includes("idempotency")
  ) {
    return new ZamaPayIdempotencyError(message, options)
  }
  if (status === 400 || status === 404 || parsed.type === "invalid_request_error") {
    return new ZamaPayInvalidRequestError(message, options)
  }

  return new ZamaPayApiError(message, options)
}

export type ZamaPayNormalizedError = {
  error?: {
    code?: unknown
    message?: unknown
    type?: unknown
  }
}

function parseError(rawBody: string): { code?: string; message?: string; type?: string } {
  try {
    const body = JSON.parse(rawBody) as ZamaPayNormalizedError
    const error = body.error
    if (!error) {
      return {}
    }

    return {
      code: typeof error.code === "string" ? error.code : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
      type: typeof error.type === "string" ? error.type : undefined,
    }
  } catch {
    return {}
  }
}
