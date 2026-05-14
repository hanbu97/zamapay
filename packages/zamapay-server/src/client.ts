import { ZamaPayInvalidRequestError } from "./errors.ts"
import { PaymentRail, requirePaymentRail } from "./rails.ts"
import {
  DEFAULT_ZAMAPAY_API_BASE_URL,
  type FetchLike,
  type FetchResponse,
  type ZamaPayLastResponse,
  ZamaPayRequestSender,
  type ZamaPayRequestSenderOptions,
  type ZamaPayResponse,
  ZAMAPAY_API_VERSION_HEADER,
  ZAMAPAY_PREVIEW_API_VERSION,
} from "./request.ts"

export {
  DEFAULT_ZAMAPAY_API_BASE_URL,
  type FetchLike,
  type FetchResponse,
  type ZamaPayLastResponse,
  type ZamaPayResponse,
  ZAMAPAY_API_VERSION_HEADER,
  ZAMAPAY_PREVIEW_API_VERSION,
} from "./request.ts"

export type ZamaPayClientOptions = ZamaPayRequestSenderOptions & {
  projectId?: string
}

export type ProjectSecretBootstrapResponse = {
  environment: "local_dev" | "sepolia"
  projectId: string
  webhookEndpointId?: string | null
  webhookEndpointUrl?: string | null
  webhookSecret?: string | null
}

export type CheckoutSessionCommonInput = {
  amountLabel: string
  amountMinorUnits: number
  cancelUrl?: string | null
  idempotencyKey: string
  merchantOrderId: string
  metadata?: Record<string, string>
  note: string
  successUrl?: string | null
  title: string
}

export type CreateZamaPrivateCheckoutSessionInput = CheckoutSessionCommonInput & {
  chainInvoiceId: number
  chainTxHash: string
  evmChainId?: never
  evmTokenSymbol?: never
  paymentRail: typeof PaymentRail.ZamaPrivate
}

export type CreateEvmErc20CheckoutSessionInput = CheckoutSessionCommonInput & {
  chainInvoiceId?: never
  chainTxHash?: never
  evmChainId: number
  evmTokenSymbol: string
  paymentRail: typeof PaymentRail.EvmErc20
}

export type CreateCheckoutSessionInput =
  | CreateZamaPrivateCheckoutSessionInput
  | CreateEvmErc20CheckoutSessionInput

export type CheckoutSession = {
  amountLabel: string
  amountMinorUnits: number
  checkoutSessionId: string
  checkoutUrl: string
  environment: "local_dev" | "sepolia"
  invoiceId: string
  merchantOrderId: string
  paymentIntentId?: string | null
  paymentRail: PaymentRail
  projectId: string
  status: string
}

export type CheckoutSessionResponse = CheckoutSession & {
  evmPaymentIntent?: unknown
  merchantOwnerWallet: string
}

export type CheckoutCreateOptions = {
  maxNetworkRetries?: number
  projectId?: string
  timeoutMs?: number
}

export type CheckoutRetrieveOptions = {
  maxNetworkRetries?: number
  projectId?: string
  timeoutMs?: number
}

type CheckoutSessionRequestBody = Omit<CheckoutSessionCommonInput, "idempotencyKey"> &
  (
    | {
        chainInvoiceId: number
        chainTxHash: string
        paymentRail: typeof PaymentRail.ZamaPrivate
      }
    | {
        evmChainId: number
        evmTokenSymbol: string
        paymentRail: typeof PaymentRail.EvmErc20
      }
  )

export class ZamaPayClient {
  readonly apiVersion: string
  readonly baseUrl: string
  readonly checkoutSessions: {
    create(
      input: CreateCheckoutSessionInput,
      options?: CheckoutCreateOptions,
    ): Promise<ZamaPayResponse<CheckoutSessionResponse>>
    retrieve(
      checkoutSessionId: string,
      options?: CheckoutRetrieveOptions,
    ): Promise<ZamaPayResponse<CheckoutSession>>
  }

  private bootstrapPromise?: Promise<ZamaPayResponse<ProjectSecretBootstrapResponse>>
  private projectId?: string
  private readonly requestSender: ZamaPayRequestSender

  constructor(options: ZamaPayClientOptions) {
    this.requestSender = new ZamaPayRequestSender(options)
    this.apiVersion = this.requestSender.apiVersion
    this.baseUrl = this.requestSender.baseUrl
    this.projectId = options.projectId
    this.checkoutSessions = {
      create: (input, createOptions) => this.createCheckoutSession(input, createOptions),
      retrieve: (checkoutSessionId, retrieveOptions) => this.retrieveCheckoutSession(checkoutSessionId, retrieveOptions),
    }
  }

  async bootstrapProject(): Promise<ZamaPayResponse<ProjectSecretBootstrapResponse>> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.requestSender
        .request<ProjectSecretBootstrapResponse>("GET", "/api/project-secret/bootstrap")
        .then(
          (response) => {
            this.projectId = response.projectId
            return response
          },
          (error: unknown) => {
            this.bootstrapPromise = undefined
            throw error
          },
        )
    }

    return this.bootstrapPromise
  }

  private async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    options: CheckoutCreateOptions = {},
  ): Promise<ZamaPayResponse<CheckoutSessionResponse>> {
    const projectId = await this.resolveProjectId(options.projectId)
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)

    return this.requestSender.request<CheckoutSessionResponse>("POST", `/api/projects/${projectId}/checkout-sessions`, {
      body: checkoutSessionBody(input),
      idempotencyKey,
      maxNetworkRetries: options.maxNetworkRetries,
      timeoutMs: options.timeoutMs,
    })
  }

  private async retrieveCheckoutSession(
    checkoutSessionId: string,
    options: CheckoutRetrieveOptions = {},
  ): Promise<ZamaPayResponse<CheckoutSession>> {
    if (!checkoutSessionId || !checkoutSessionId.trim()) {
      throw new ZamaPayInvalidRequestError("checkoutSessionId is required", {
        code: "missing_checkout_session_id",
      })
    }

    const projectId = await this.resolveProjectId(options.projectId)
    return this.requestSender.request<CheckoutSession>(
      "GET",
      `/api/projects/${projectId}/checkout-sessions/${encodeURIComponent(checkoutSessionId)}`,
      {
        maxNetworkRetries: options.maxNetworkRetries,
        timeoutMs: options.timeoutMs,
      },
    )
  }

  private async resolveProjectId(projectId?: string): Promise<string> {
    const resolved = projectId ?? this.projectId
    if (resolved) {
      return resolved
    }

    const bootstrap = await this.bootstrapProject()
    return bootstrap.projectId
  }
}

function checkoutSessionBody(input: CreateCheckoutSessionInput): CheckoutSessionRequestBody {
  const paymentRail = requirePaymentRail(input.paymentRail)
  const base = checkoutSessionBaseBody(input)

  if (paymentRail === PaymentRail.ZamaPrivate) {
    rejectExtraneousFields(input, ["evmChainId", "evmTokenSymbol"])
    return {
      ...base,
      chainInvoiceId: validateSafeInteger(input.chainInvoiceId, "chainInvoiceId"),
      chainTxHash: validateNonEmptyString(input.chainTxHash, "chainTxHash"),
      paymentRail,
    }
  }

  rejectExtraneousFields(input, ["chainInvoiceId", "chainTxHash"])
  return {
    ...base,
    evmChainId: validateSafeInteger(input.evmChainId, "evmChainId"),
    evmTokenSymbol: validateNonEmptyString(input.evmTokenSymbol, "evmTokenSymbol"),
    paymentRail,
  }
}

function checkoutSessionBaseBody(input: CheckoutSessionCommonInput): Omit<CheckoutSessionCommonInput, "idempotencyKey"> {
  return {
    amountLabel: input.amountLabel,
    amountMinorUnits: validateSafeInteger(input.amountMinorUnits, "amountMinorUnits"),
    cancelUrl: input.cancelUrl,
    merchantOrderId: validateNonEmptyString(input.merchantOrderId, "merchantOrderId"),
    metadata: input.metadata,
    note: input.note,
    successUrl: input.successUrl,
    title: validateNonEmptyString(input.title, "title"),
  }
}

function validateIdempotencyKey(value: string): string {
  return validateNonEmptyString(value, "idempotencyKey")
}

function validateNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ZamaPayInvalidRequestError(`${name} is required`, {
      code: `missing_${name}`,
    })
  }

  return value
}

function validateSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ZamaPayInvalidRequestError(`${name} must be a non-negative integer`, {
      code: `invalid_${name}`,
    })
  }

  return Number(value)
}

function rejectExtraneousFields(input: object, fieldNames: string[]): void {
  for (const fieldName of fieldNames) {
    if (fieldName in input && (input as Record<string, unknown>)[fieldName] !== undefined) {
      throw new ZamaPayInvalidRequestError(`${fieldName} does not belong to this paymentRail`, {
        code: `unexpected_${fieldName}`,
      })
    }
  }
}
