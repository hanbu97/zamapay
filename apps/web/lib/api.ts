import { contractEnvironmentConfig, publicContractEnvironment } from './contract-environment.ts'
import { runtimeApiBaseUrl } from './runtime-profile.ts'

export type NonceResponse = {
  nonce: string
  message: string
  expiresAt: string
}

export type VerifyPayload = {
  address: string
  nonce: string
  message: string
  signature: string
}

export type SessionResponse = {
  authenticated: boolean
  user: null | {
    address: string
    sessionId: string
    issuedAt: string
  }
}

export type SettlementSnapshot = {
  invoiceId: number
  paymentTruth: 'draft' | 'pending_payment' | 'paid' | 'expired' | 'failed'
  finalityStatus: 'not_paid' | 'indexing' | 'awaiting_finality' | 'finality_safe' | 'reorg_exception'
  decryptJobStatus: 'idle' | 'requested' | 'pending_result' | 'completed' | 'failed_timeout' | 'failed_replay_guard'
  fulfillmentStatus: 'not_ready' | 'ready' | 'released' | 'release_failed' | 'frozen_for_manual_intervention'
}

export type WebhookDeliverySnapshot = {
  status: 'idle' | 'pending' | 'retry_scheduled' | 'delivered' | 'dead_letter'
  attemptCount: number
  nextRetryAfterSeconds: number | null
}

export type DecryptRequestSnapshot = {
  requestId: string
  requestedAt: string
  completedAt: string | null
  callbackSender: string | null
  replayedCallbackCount: number
}

export type InvoiceRecord = {
  invoiceId: string
  projectId?: string | null
  checkoutSessionId?: string | null
  environment?: string | null
  externalRef?: string | null
  title: string
  merchantName: string
  amountLabel: string
  amountMinorUnits: number
  billing?: CheckoutBillingSnapshot | null
  note: string
  paymentRail: PaymentRail
  chainInvoiceId: number | null
  chainTxHash: string | null
  paymentIntentId?: string | null
  paymentTxHash: string | null
  payerAddress: string | null
  finalityConfirmations: number
  finalityThreshold: number
  webhook?: WebhookDeliverySnapshot
  decryptRequest?: DecryptRequestSnapshot | null
  decryptPendingGuardTrips?: number
  fulfillmentRelease?: FulfillmentReleaseAudit | null
  snapshot: SettlementSnapshot
}

export type FulfillmentReleaseAudit = {
  invoiceId: string
  jobId: string
  releasedAt: string
  artifactCount: number
}

export type FulfillmentResponse = {
  invoiceId: string
  decision: 'hold' | 'enqueue_release' | 'released' | 'freeze_for_manual_intervention'
  artifacts: Array<{
    label: string
    secret: string
  }>
  release: FulfillmentReleaseAudit | null
}

export type DashboardOverview = {
  merchantName: string
  merchantAddress: string
  summary: {
    totalInvoices: number
    paidInvoices: number
    pendingInvoices: number
    finalityBacklog: number
  }
  invoices: InvoiceRecord[]
}

export type ContractManifest = {
  network: string
  chainId: number | null
  generatedAt: string
  deployer?: string | null
  platformFeeWallet?: string | null
  contracts: {
    MerchantRegistry: string | null
    ConfidentialUSDMock: string | null
    SubscriptionPass: string | null
    PrivateSubscriptionRegistry: string | null
    PrivateCheckoutSettlement: string | null
    EvmCheckoutSettlement: string | null
  }
  billing?: {
    source: string | null
    defaultFeeBps: number | null
    monthlyPeriodSeconds: number | null
    annualPeriodSeconds: number | null
    plans: Array<{
      plan: BillingPlan
      planCode: number | null
      checkoutFeeBps: number | null
      monthlyPriceMinorUnits: number | null
      annualPriceMinorUnits: number | null
      selfServe: boolean
    }>
  }
  standardErc20Tokens?: Array<{
    symbol: string | null
    contract: string | null
    decimals: number | null
    faucetFunctionName: string | null
  }>
}

export type ProjectEnvironmentKind = 'local_dev' | 'sepolia'
export type ProjectStatus = 'active' | 'disabled'
export type CheckoutSessionStatus = 'created' | 'open' | 'paid' | 'expired' | 'cancelled' | 'failed'
export type PaymentRail = 'zama_private' | 'evm_erc20'
export type BillingPlan = 'free' | 'growth' | 'enterprise'
export type BillingCycle = 'monthly' | 'annual'
export type BillingSubscriptionStatus = 'active' | 'past_due' | 'cancelled'
export type BillingEntitlementStatus =
  | 'contract_default'
  | 'local_only'
  | 'pending_private_proof'
  | 'anchored'
  | 'rejected'
export type BillingPaymentStatus = 'succeeded' | 'pending' | 'failed'

export type BillingPlanCatalogEntry = {
  plan: BillingPlan
  name: string
  planCode: number | null
  checkoutFeeBps: number | null
  monthlyPriceMinorUnits: number | null
  annualPriceMinorUnits: number | null
  monthlyPriceUsd: number | null
  annualPriceUsd: number | null
  selfServe: boolean
  description: string
}

export type BillingSubscription = {
  subscriptionId: string
  ownerWallet: string
  plan: BillingPlan
  billingCycle: BillingCycle
  status: BillingSubscriptionStatus
  passId?: string | null
  entitlementVersion: number
  entitlementStatus: BillingEntitlementStatus
  entitlementTxHash?: string | null
  subscriptionCheckHandle?: string | null
  currentPeriodStartedAt: string
  currentPeriodEndsAt: string
  updatedAt: string
}

export type BillingPaymentRecord = {
  paymentId: string
  ownerWallet: string
  plan: BillingPlan
  billingCycle: BillingCycle
  amountMinorUnits: number
  currency: string
  status: BillingPaymentStatus
  chainTxHash?: string | null
  subscriptionCheckHandle?: string | null
  createdAt: string
}

export type BillingSubscriptionResponse = {
  subscription: BillingSubscription
  plans: BillingPlanCatalogEntry[]
  payments: BillingPaymentRecord[]
}

export type BillingUpgradeIntentPayload = {
  plan: BillingPlan
  billingCycle?: BillingCycle
}

export type UpgradeBillingSubscriptionPayload = {
  plan: BillingPlan
  billingCycle?: BillingCycle
  chainTxHash?: string | null
  subscriptionCheckHandle?: string | null
}

export type BillingUpgradeIntentResponse = {
  passId: string | null
  ownerWallet: string
  plan: BillingPlan
  billingCycle: BillingCycle
  planCode: number
  priceMinorUnits: number
  periodDays: number
  expectedFeeBps: number
  chargeTokenContract: string | null
  subscriptionRegistryContract: string | null
  treasuryWallet: string | null
  privacyNote: string
}

export type CheckoutBillingSnapshot = {
  plan: BillingPlan
  feeBps: number
  grossAmountMinorUnits: number
  platformFeeMinorUnits: number
  merchantNetMinorUnits: number
}

export type PaymentProject = {
  projectId: string
  name: string
  ownerWallet: string
  defaultEnvironment: ProjectEnvironmentKind
  billingPlan: BillingPlan
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export type PaymentProjectEnvironment = {
  environmentId: string
  projectId: string
  environment: ProjectEnvironmentKind
  chainId: number | null
  settlementContract: string | null
  tokenContract: string | null
  invoiceAuthorityId: string
  status: ProjectStatus
}

export type ProjectPaymentRailSetting = {
  projectId: string
  paymentRail: PaymentRail
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type SupportedEvmAsset = {
  chainId: number
  network: string
  chainName: string
  nativeSymbol: string
  tokenSymbol: string
  tokenContract: string
  tokenDecimals: number
  minAmountMinorUnits: number
  finalityThreshold: number
  rpcUrl: string
  settlementContract: string
}

export type EvmPaymentIntentStatus =
  | 'requires_payment'
  | 'detected'
  | 'confirmed'
  | 'underpaid'
  | 'overpaid'
  | 'expired'
  | 'failed'

export type EvmPaymentIntent = {
  intentId: string
  projectId: string
  checkoutSessionId: string
  settlementIntentId: string
  settlementProjectId: string
  chainId: number
  network: string
  tokenSymbol: string
  tokenContract: string
  tokenDecimals: number
  expectedAmountMinorUnits: number
  merchantNetMinorUnits: number
  platformFeeMinorUnits: number
  matchedAmountMinorUnits: number
  settlementContract: string
  finalityThreshold: number
  status: EvmPaymentIntentStatus
  detectedTxHash: string | null
  payerAddress: string | null
  confirmations: number
  createdAt: string
  expiresAt: string
  updatedAt: string
}

export type EvmSettlementEventStatus =
  | 'detected'
  | 'confirmed'
  | 'underpaid'
  | 'overpaid'
  | 'duplicate'
  | 'expired'
  | 'reorged'
  | 'ignored'

export type EvmSettlementLedgerEntry = {
  settlementEventId: string
  chainId: number
  tokenContract: string
  fromAddress: string
  toAddress: string
  amountMinorUnits: number
  txHash: string
  logIndex: number
  blockNumber: number
  blockHash: string | null
  confirmations: number
  matchedIntentId: string | null
  status: EvmSettlementEventStatus
  observedAt: string
  updatedAt: string
}

export type EvmAssetBalance = {
  projectId: string
  chainId: number
  network: string
  tokenSymbol: string
  tokenContract: string
  tokenDecimals: number
  confirmedMinorUnits: number
  pendingMinorUnits: number
  exceptionMinorUnits: number
  withdrawableMinorUnits: number
}

export type ProjectInvoiceAuthority = {
  authorityId: string
  projectId: string
  environment: ProjectEnvironmentKind
  mode: 'platform_hosted_signer'
  signerAddress: string
  keyRef: string
  merchantRegistered: boolean
  createdAt: string
}

export type ProjectSecret = {
  keyId: string
  projectId: string
  environment: ProjectEnvironmentKind
  label: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type ProjectWebhookEndpoint = {
  endpointId: string
  projectId: string
  environment: ProjectEnvironmentKind
  url: string
  enabled: boolean
  secretPreview: string
  createdAt: string
  updatedAt: string
}

export type CheckoutSession = {
  checkoutSessionId: string
  projectId: string
  environment: ProjectEnvironmentKind
  paymentRail: PaymentRail
  merchantOrderId: string
  idempotencyKey: string
  invoiceId: string
  chainInvoiceId: number | null
  chainTxHash: string | null
  paymentIntentId: string | null
  checkoutUrl: string
  title: string
  amountLabel: string
  amountMinorUnits: number
  billing: CheckoutBillingSnapshot
  note: string
  successUrl: string | null
  cancelUrl: string | null
  metadata: Record<string, string>
  status: CheckoutSessionStatus
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export type WebhookEventRecord = {
  eventId: string
  projectId: string
  environment: ProjectEnvironmentKind
  eventType: string
  subjectType: string
  subjectId: string
  payload: Record<string, unknown>
  createdAt: string
}

export type WebhookDeliveryRecord = {
  deliveryId: string
  eventId: string
  endpointId: string
  projectId: string
  environment: ProjectEnvironmentKind
  attemptCount: number
  status: WebhookDeliverySnapshot['status']
  signatureHeader?: string | null
  httpStatus: number | null
  responseBody: string | null
  error: string | null
  nextRetryAt: string | null
  createdAt: string
  deliveredAt: string | null
}

export type ProjectWithdrawalRecord = {
  withdrawalId: string
  projectId: string
  amountMinorUnits: number
  chainId: number | null
  tokenContract: string | null
  settlementContract: string | null
  recipientAddress: string | null
  status: 'completed'
  receipt: string
  createdAt: string
  completedAt: string
}

export type CreatePaymentProjectResponse = {
  project: PaymentProject
  environment: PaymentProjectEnvironment
  invoiceAuthority: ProjectInvoiceAuthority
  webhookEndpoint: ProjectWebhookEndpoint | null
}

export type CreateProjectSecretResponse = {
  secretKey: string
  keyRecord: ProjectSecret
}

export type ConfigureWebhookEndpointResponse = {
  endpoint: ProjectWebhookEndpoint
}

export type RotateWebhookEndpointSecretResponse = {
  endpoint: ProjectWebhookEndpoint
}

export type ProjectDashboardOverview = {
  project: PaymentProject
  environments: PaymentProjectEnvironment[]
  paymentRails: ProjectPaymentRailSetting[]
  projectSecrets: ProjectSecret[]
  webhookEndpoints: ProjectWebhookEndpoint[]
  checkoutSessions: CheckoutSession[]
  webhookEvents: WebhookEventRecord[]
  webhookDeliveries: WebhookDeliveryRecord[]
  withdrawals: ProjectWithdrawalRecord[]
  supportedEvmAssets: SupportedEvmAsset[]
  evmAssetBalances: EvmAssetBalance[]
  evmPaymentIntents: EvmPaymentIntent[]
  evmSettlementLedger: EvmSettlementLedgerEntry[]
  summary: {
    totalCheckouts: number
    openCheckouts: number
    paidCheckouts: number
    grossVolumeMinorUnits: number
    platformFeeMinorUnits: number
    merchantNetMinorUnits: number
    withdrawnMinorUnits: number
    withdrawableMinorUnits: number
    pendingDeliveries: number
    deliveredWebhooks: number
    failedWebhooks: number
  }
}

export type PublicCheckoutResponse = {
  invoice: InvoiceRecord
  session: CheckoutSession | null
  evmPaymentIntent: EvmPaymentIntent | null
  evmAsset: SupportedEvmAsset | null
}

export type CreatePaymentProjectPayload = {
  name: string
  environment?: ProjectEnvironmentKind
  webhookUrl?: string
}

export type CreateProjectSecretPayload = {
  label?: string
  environment?: ProjectEnvironmentKind
}

export type ConfigureWebhookEndpointPayload = {
  url: string
  environment?: ProjectEnvironmentKind
  enabled?: boolean
}

export type UpdateProjectPaymentRailPayload = {
  enabled: boolean
}

export type CreateProjectWithdrawalPayload = {
  amountMinorUnits: number
  chainTxHash: string
  chainId?: number
  tokenContract?: string
  settlementContract?: string
  recipientAddress?: string
  settlementBucketCommitment?: string
  withdrawalNonce?: string
  withdrawCheckHandle?: string
}

export class ApiRequestError extends Error {
  readonly body: string
  readonly status: number

  constructor(message: string, status: number, body = '') {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }
}

const apiBaseUrl = runtimeApiBaseUrl()

type ApiFetchOptions = {
  body?: unknown
  cache?: RequestCache
  cookieHeader?: string
  credentials?: RequestCredentials
  fallback: string
  method?: string
}

function rustApiUrl(path: string) {
  return typeof window === 'undefined' ? `${apiBaseUrl}${path}` : path
}

function platformApiUrl(path: string) {
  return `${apiBaseUrl}${path}`
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403)
}

async function apiRequestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body = await response.text().catch(() => '')
  const fallbackMessage = `${fallback.replace(/[.!?]$/, '')} with ${response.status}.`
  return new ApiRequestError(body || fallbackMessage, response.status, body)
}

async function fetchApiJson<T>(url: string, options: ApiFetchOptions): Promise<T> {
  const response = await fetch(url, apiFetchInit(options))
  if (!response.ok) {
    throw await apiRequestError(response, options.fallback)
  }

  return response.json() as Promise<T>
}

async function fetchOptionalApiJson<T>(url: string, options: ApiFetchOptions): Promise<T | null> {
  const response = await fetch(url, apiFetchInit(options))
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw await apiRequestError(response, options.fallback)
  }

  return response.json() as Promise<T>
}

async function fetchApiOk(url: string, options: ApiFetchOptions): Promise<void> {
  const response = await fetch(url, apiFetchInit(options))
  if (!response.ok) {
    throw await apiRequestError(response, options.fallback)
  }
}

function apiFetchInit(options: ApiFetchOptions): RequestInit {
  const headers = new Headers()
  const hasBody = options.body !== undefined

  if (hasBody) {
    headers.set('content-type', 'application/json')
  }
  if (options.cookieHeader) {
    headers.set('cookie', options.cookieHeader)
  }

  return {
    body: hasBody ? JSON.stringify(options.body) : undefined,
    cache: options.cache,
    credentials: options.credentials,
    headers,
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
  }
}

export async function requestNonce(address: string): Promise<NonceResponse> {
  return fetchApiJson('/api/auth/nonce', {
    body: { address },
    credentials: 'include',
    fallback: 'Nonce request failed.',
  })
}

export async function verifySignature(payload: VerifyPayload): Promise<void> {
  await fetchApiOk('/api/auth/verify', {
    body: payload,
    credentials: 'include',
    fallback: 'Signature verification failed.',
  })
}

export async function getSession(cookieHeader: string): Promise<SessionResponse> {
  try {
    return await fetchApiJson(platformApiUrl('/api/session'), {
      cache: 'no-store',
      cookieHeader,
      fallback: 'Session lookup failed.',
    })
  } catch {
    return { authenticated: false, user: null }
  }
}

export async function getOptionalSession(cookieHeader: string): Promise<SessionResponse> {
  try {
    return await getSession(cookieHeader)
  } catch {
    return { authenticated: false, user: null }
  }
}

export async function logoutSession(): Promise<void> {
  try {
    const response = await fetch(platformApiUrl('/api/session'), {
      method: 'DELETE',
      credentials: 'include',
    })

    if (response.ok) {
      return
    }
  } catch {
    // 本地 API 可能还是旧进程；同源兜底只清 cookie，不丢内存数据。
  }

  await clearBrowserSessionCookie()
}

export async function getDashboardOverview(cookieHeader: string): Promise<DashboardOverview> {
  return fetchApiJson(platformApiUrl('/api/dashboard/overview'), {
    cache: 'no-store',
    cookieHeader,
    fallback: 'Dashboard overview failed.',
  })
}

async function clearBrowserSessionCookie(): Promise<void> {
  await fetchApiOk('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    fallback: 'Logout failed.',
  })
}

export async function getContractManifest(environment?: string | null): Promise<ContractManifest> {
  const manifest = contractEnvironmentConfig(environment ?? publicContractEnvironment()).manifest
  if (!manifest) {
    throw new Error(`Contract manifest is not available for ${environment ?? 'the active environment'}.`)
  }

  return manifest as ContractManifest
}

export async function getInvoiceRecord(invoiceId: string): Promise<InvoiceRecord | null> {
  return fetchOptionalApiJson(platformApiUrl(`/api/invoices/${invoiceId}`), {
    cache: 'no-store',
    fallback: 'Invoice lookup failed.',
  })
}

export async function getPublicCheckout(checkoutId: string): Promise<PublicCheckoutResponse | null> {
  return fetchOptionalApiJson(platformApiUrl(`/api/checkout/${checkoutId}`), {
    cache: 'no-store',
    fallback: 'Checkout lookup failed.',
  })
}

export async function getSupportedEvmAssets(): Promise<SupportedEvmAsset[]> {
  return fetchApiJson(platformApiUrl('/api/supported-assets'), {
    cache: 'no-store',
    fallback: 'Supported asset lookup failed.',
  })
}

export async function getFulfillment(invoiceId: string): Promise<FulfillmentResponse | null> {
  return fetchOptionalApiJson(platformApiUrl(`/api/invoices/${invoiceId}/fulfillment`), {
    cache: 'no-store',
    fallback: 'Fulfillment lookup failed.',
  })
}

export async function getPaymentProjects(cookieHeader: string): Promise<PaymentProject[]> {
  return fetchApiJson(rustApiUrl('/api/projects'), {
    cache: 'no-store',
    cookieHeader,
    credentials: 'include',
    fallback: 'Project list failed.',
  })
}

export async function getBillingSubscription(cookieHeader: string): Promise<BillingSubscriptionResponse> {
  return fetchApiJson(rustApiUrl('/api/billing/subscription'), {
    cache: 'no-store',
    cookieHeader,
    credentials: 'include',
    fallback: 'Billing subscription lookup failed.',
  })
}

export async function createBillingUpgradeIntent(
  payload: BillingUpgradeIntentPayload,
): Promise<BillingUpgradeIntentResponse> {
  return fetchApiJson(rustApiUrl('/api/billing/subscription/upgrade-intent'), {
    body: payload,
    credentials: 'include',
    fallback: 'Billing upgrade intent failed.',
  })
}

export async function upgradeBillingSubscription(
  payload: UpgradeBillingSubscriptionPayload,
): Promise<BillingSubscriptionResponse> {
  return fetchApiJson(rustApiUrl('/api/billing/subscription/upgrade'), {
    body: payload,
    credentials: 'include',
    fallback: 'Billing subscription upgrade failed.',
  })
}

export async function getProjectOverview(projectId: string, cookieHeader: string): Promise<ProjectDashboardOverview> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}`), {
    cache: 'no-store',
    cookieHeader,
    credentials: 'include',
    fallback: 'Project overview failed.',
  })
}

export async function createPaymentProject(payload: CreatePaymentProjectPayload): Promise<CreatePaymentProjectResponse> {
  return fetchApiJson(rustApiUrl('/api/projects'), {
    body: payload,
    credentials: 'include',
    fallback: 'Project creation failed.',
  })
}

export async function createProjectSecret(
  projectId: string,
  payload: CreateProjectSecretPayload,
): Promise<CreateProjectSecretResponse> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/project-secrets`), {
    body: payload,
    credentials: 'include',
    fallback: 'Project secret creation failed.',
  })
}

export async function configureProjectWebhook(
  projectId: string,
  payload: ConfigureWebhookEndpointPayload,
): Promise<ConfigureWebhookEndpointResponse> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/webhook-endpoints`), {
    body: payload,
    credentials: 'include',
    fallback: 'Webhook configuration failed.',
  })
}

export async function rotateProjectWebhookSecret(
  projectId: string,
  endpointId: string,
): Promise<RotateWebhookEndpointSecretResponse> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/webhook-endpoints/${endpointId}/rotate-secret`), {
    method: 'POST',
    credentials: 'include',
    fallback: 'Webhook secret rotation failed.',
  })
}

export async function updateProjectPaymentRail(
  projectId: string,
  paymentRail: PaymentRail,
  payload: UpdateProjectPaymentRailPayload,
): Promise<ProjectDashboardOverview> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/payment-rails/${paymentRail}`), {
    body: payload,
    credentials: 'include',
    method: 'PATCH',
    fallback: 'Payment method update failed.',
  })
}

export async function createProjectWithdrawal(
  projectId: string,
  payload: CreateProjectWithdrawalPayload,
): Promise<ProjectDashboardOverview> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/withdrawals`), {
    body: payload,
    credentials: 'include',
    fallback: 'Project withdrawal failed.',
  })
}

export async function testProjectWebhook(projectId: string, endpointId: string): Promise<WebhookDeliveryRecord[]> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/webhook-endpoints/${endpointId}/test`), {
    method: 'POST',
    credentials: 'include',
    fallback: 'Webhook test failed.',
  })
}

export async function resendProjectWebhookDelivery(projectId: string, deliveryId: string): Promise<WebhookDeliveryRecord[]> {
  return fetchApiJson(rustApiUrl(`/api/projects/${projectId}/deliveries/${deliveryId}/resend`), {
    method: 'POST',
    credentials: 'include',
    fallback: 'Webhook resend failed.',
  })
}
