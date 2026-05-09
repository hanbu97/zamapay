import { NextResponse } from 'next/server'
import { getAddress, isHex } from 'viem'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { isLocalRequestUrl } from '@/lib/dev-signer-gate'
import type { BillingCycle } from '@/lib/api'

type LocalGrowthRequest = {
  billingCycle?: unknown
  entitlementTxHash?: unknown
  entitlementVersion?: unknown
  ownerAddress?: unknown
  passId?: unknown
  plan?: unknown
  subscriptionCheckHandle?: unknown
}

type SubscriptionProjectionBody = {
  billingCycle: BillingCycle
  entitlementTxHash: string
  entitlementVersion: number
  passId: string
  plan: 'growth'
  subscriptionCheckHandle: string
}

const rustApiBaseUrl = process.env.MERMER_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'
const defaultOperatorKey = 'local-operator-dev-key'

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    process.env.NODE_ENV !== 'production' &&
    isLocalRequestUrl(request.url)
  )
}

function operatorKey() {
  return process.env.MERMER_OPERATOR_KEY ?? defaultOperatorKey
}

function billingCycle(value: unknown): BillingCycle {
  return value === 'annual' ? 'annual' : 'monthly'
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`)
  }

  return value.trim()
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer.`)
  }

  return value
}

function requiredHex(value: unknown, field: string): string {
  const text = requiredText(value, field)
  if (!isHex(text)) {
    throw new Error(`${field} must be a hex string.`)
  }

  return text
}

function requiredGrowthPlan(value: unknown): 'growth' {
  if (value !== 'growth') {
    throw new Error('plan must be growth.')
  }

  return 'growth'
}

async function projectSubscription(ownerAddress: string, body: SubscriptionProjectionBody) {
  const response = await fetch(`${rustApiBaseUrl}/api/operator/subscription-entitlements/${ownerAddress}/projection`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': operatorKey(),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`subscription projection failed with ${response.status}: ${text}`)
  }

  return JSON.parse(text) as unknown
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local-dev Growth projection is disabled' }, { status: 404 })
  }

  const payload = (await request.json().catch(() => ({}))) as LocalGrowthRequest
  if (typeof payload.ownerAddress !== 'string') {
    return NextResponse.json({ error: 'ownerAddress is required.' }, { status: 400 })
  }

  try {
    const cycle = billingCycle(payload.billingCycle)
    const ownerAddress = getAddress(payload.ownerAddress)
    const body: SubscriptionProjectionBody = {
      billingCycle: cycle,
      entitlementTxHash: requiredHex(payload.entitlementTxHash, 'entitlementTxHash'),
      entitlementVersion: requiredPositiveInteger(payload.entitlementVersion, 'entitlementVersion'),
      passId: requiredText(payload.passId, 'passId'),
      plan: requiredGrowthPlan(payload.plan),
      subscriptionCheckHandle: requiredHex(payload.subscriptionCheckHandle, 'subscriptionCheckHandle'),
    }
    const subscription = await projectSubscription(ownerAddress, body)

    return NextResponse.json(subscription)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local-dev Growth projection failed'
    const status = message.includes('required') || message.includes('must be') ? 400 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
