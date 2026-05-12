import { contractEnvironmentConfig } from './contract-environment.ts'

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
  chainInvoiceId: number | null
  chainTxHash: string | null
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
}

export type ProjectEnvironmentKind = 'local_dev' | 'sepolia'
export type ProjectStatus = 'active' | 'disabled'
export type CheckoutSessionStatus = 'created' | 'open' | 'paid' | 'expired' | 'cancelled' | 'failed'
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

export type ProjectApiKey = {
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
  merchantOrderId: string
  idempotencyKey: string
  invoiceId: string
  chainInvoiceId: number
  chainTxHash: string
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
  signatureHeader: string | null
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
  webhookSecret: string | null
}

export type CreateProjectApiKeyResponse = {
  apiKey: string
  keyRecord: ProjectApiKey
}

export type ConfigureWebhookEndpointResponse = {
  endpoint: ProjectWebhookEndpoint
  webhookSecret: string | null
}

export type ProjectDashboardOverview = {
  project: PaymentProject
  environments: PaymentProjectEnvironment[]
  apiKeys: ProjectApiKey[]
  webhookEndpoints: ProjectWebhookEndpoint[]
  checkoutSessions: CheckoutSession[]
  webhookEvents: WebhookEventRecord[]
  webhookDeliveries: WebhookDeliveryRecord[]
  withdrawals: ProjectWithdrawalRecord[]
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

export type CreatePaymentProjectPayload = {
  name: string
  environment?: ProjectEnvironmentKind
  webhookUrl?: string
}

export type CreateProjectApiKeyPayload = {
  label?: string
  environment?: ProjectEnvironmentKind
}

export type ConfigureWebhookEndpointPayload = {
  url: string
  environment?: ProjectEnvironmentKind
  enabled?: boolean
}

export type CreateProjectWithdrawalPayload = {
  amountMinorUnits: number
  chainTxHash: string
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

const apiBaseUrl = process.env.ZAMAPAY_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'

function rustApiUrl(path: string) {
  return typeof window === 'undefined' ? `${apiBaseUrl}${path}` : path
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403)
}

async function apiRequestError(response: Response, fallback: string): Promise<ApiRequestError> {
  const body = await response.text().catch(() => '')
  return new ApiRequestError(body || fallback, response.status, body)
}

export async function requestNonce(address: string): Promise<NonceResponse> {
  const response = await fetch('/api/auth/nonce', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ address }),
  })

  if (!response.ok) {
    throw new Error(`Nonce request failed with ${response.status}.`)
  }

  return response.json()
}

export async function verifySignature(payload: VerifyPayload): Promise<void> {
  const response = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Signature verification failed with ${response.status}.`)
  }
}

export async function getSession(cookieHeader: string): Promise<SessionResponse> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/session`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
      cache: 'no-store',
    })
  } catch {
    return { authenticated: false, user: null }
  }

  if (!response.ok) {
    return { authenticated: false, user: null }
  }

  return response.json()
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
    const response = await fetch(`${apiBaseUrl}/api/session`, {
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
  const response = await fetch(`${apiBaseUrl}/api/dashboard/overview`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Dashboard overview failed with ${response.status}.`)
  }

  return response.json()
}

async function clearBrowserSessionCookie(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Logout failed with ${response.status}.`)
  }
}

export async function getContractManifest(environment?: string | null): Promise<ContractManifest> {
  const manifest = contractEnvironmentConfig(environment ?? process.env.NEXT_PUBLIC_CONTRACT_ENV).manifest
  if (!manifest) {
    throw new Error(`Contract manifest is not available for ${environment ?? 'the active environment'}.`)
  }

  return manifest as ContractManifest
}

export async function getInvoiceRecord(invoiceId: string): Promise<InvoiceRecord | null> {
  const response = await fetch(`${apiBaseUrl}/api/invoices/${invoiceId}`, {
    cache: 'no-store',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Invoice lookup failed with ${response.status}.`)
  }

  return response.json()
}

export async function getFulfillment(invoiceId: string): Promise<FulfillmentResponse | null> {
  const response = await fetch(`${apiBaseUrl}/api/invoices/${invoiceId}/fulfillment`, {
    cache: 'no-store',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Fulfillment lookup failed with ${response.status}.`)
  }

  return response.json()
}

export async function getPaymentProjects(cookieHeader: string): Promise<PaymentProject[]> {
  const response = await fetch(rustApiUrl('/api/projects'), {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    credentials: 'include',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Project list failed with ${response.status}.`)
  }

  return response.json()
}

export async function getBillingSubscription(cookieHeader: string): Promise<BillingSubscriptionResponse> {
  const response = await fetch(rustApiUrl('/api/billing/subscription'), {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    credentials: 'include',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Billing subscription lookup failed with ${response.status}.`)
  }

  return response.json()
}

export async function createBillingUpgradeIntent(
  payload: BillingUpgradeIntentPayload,
): Promise<BillingUpgradeIntentResponse> {
  const response = await fetch(rustApiUrl('/api/billing/subscription/upgrade-intent'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Billing upgrade intent failed with ${response.status}.`)
  }

  return response.json()
}

export async function upgradeBillingSubscription(
  payload: UpgradeBillingSubscriptionPayload,
): Promise<BillingSubscriptionResponse> {
  const response = await fetch(rustApiUrl('/api/billing/subscription/upgrade'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Billing subscription upgrade failed with ${response.status}.`)
  }

  return response.json()
}

export async function getProjectOverview(projectId: string, cookieHeader: string): Promise<ProjectDashboardOverview> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}`), {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    credentials: 'include',
    cache: 'no-store',
  })

  if (!response.ok) {
    throw await apiRequestError(response, `Project overview failed with ${response.status}.`)
  }

  return response.json()
}

export async function createPaymentProject(payload: CreatePaymentProjectPayload): Promise<CreatePaymentProjectResponse> {
  const response = await fetch(rustApiUrl('/api/projects'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Project creation failed with ${response.status}.`)
  }

  return response.json()
}

export async function createProjectApiKey(
  projectId: string,
  payload: CreateProjectApiKeyPayload,
): Promise<CreateProjectApiKeyResponse> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}/api-keys`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `API key creation failed with ${response.status}.`)
  }

  return response.json()
}

export async function configureProjectWebhook(
  projectId: string,
  payload: ConfigureWebhookEndpointPayload,
): Promise<ConfigureWebhookEndpointResponse> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}/webhook-endpoints`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Webhook configuration failed with ${response.status}.`)
  }

  return response.json()
}

export async function createProjectWithdrawal(
  projectId: string,
  payload: CreateProjectWithdrawalPayload,
): Promise<ProjectDashboardOverview> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}/withdrawals`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Project withdrawal failed with ${response.status}.`)
  }

  return response.json()
}

export async function testProjectWebhook(projectId: string, endpointId: string): Promise<WebhookDeliveryRecord[]> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}/webhook-endpoints/${endpointId}/test`), {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Webhook test failed with ${response.status}.`)
  }

  return response.json()
}

export async function resendProjectWebhookDelivery(projectId: string, deliveryId: string): Promise<WebhookDeliveryRecord[]> {
  const response = await fetch(rustApiUrl(`/api/projects/${projectId}/deliveries/${deliveryId}/resend`), {
    method: 'POST',
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `Webhook resend failed with ${response.status}.`)
  }

  return response.json()
}
