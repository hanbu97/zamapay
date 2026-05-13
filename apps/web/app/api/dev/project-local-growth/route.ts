import { NextResponse } from 'next/server'
import { getAddress, isHex, type Hex } from 'viem'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { isLocalRequestUrl } from '@/lib/dev-signer-gate'
import { finalizeLocalGrowthSubscription } from '@/lib/local-fhevm-dev'
import type { BillingCycle } from '@/lib/api'
import { postRustJson, RustApiError } from '@/lib/rust-api-transport'

type LocalGrowthRequest = {
  billingCycle?: unknown
  ownerAddress?: unknown
  plan?: unknown
  subscriptionRequestTxHash?: unknown
}

type SubscriptionProjectionBody = {
  billingCycle: BillingCycle
  entitlementTxHash: string
  entitlementVersion: number
  passId: string
  plan: 'growth'
  subscriptionCheckHandle: string
}

const defaultOperatorKey = 'local-operator-dev-key'

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    process.env.NODE_ENV !== 'production' &&
    isLocalRequestUrl(request.url)
  )
}

function operatorKey() {
  return process.env.ZAMAPAY_OPERATOR_KEY ?? defaultOperatorKey
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

function requiredHex(value: unknown, field: string): Hex {
  const text = requiredText(value, field)
  if (!isHex(text)) {
    throw new Error(`${field} must be a hex string.`)
  }

  return text as Hex
}

function requiredGrowthPlan(value: unknown): 'growth' {
  if (value !== 'growth') {
    throw new Error('plan must be growth.')
  }

  return 'growth'
}

async function projectSubscription(ownerAddress: string, body: SubscriptionProjectionBody) {
  try {
    return await postRustJson(`/api/operator/subscription-entitlements/${ownerAddress}/projection`, body, {
      headers: { 'x-operator-key': operatorKey() },
    })
  } catch (caught) {
    if (caught instanceof RustApiError) {
      throw new Error(`subscription projection failed with ${caught.status}: ${caught.body}`)
    }
    throw caught
  }
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
    const plan = requiredGrowthPlan(payload.plan)
    const finalized = await finalizeLocalGrowthSubscription({
      ownerAddress,
      subscriptionRequestTxHash: requiredHex(payload.subscriptionRequestTxHash, 'subscriptionRequestTxHash'),
    })
    const body: SubscriptionProjectionBody = {
      billingCycle: cycle,
      entitlementTxHash: finalized.finalizationTxHash,
      entitlementVersion: finalized.termsVersion,
      passId: finalized.passId,
      plan,
      subscriptionCheckHandle: finalized.subscriptionCheckHandle,
    }
    const subscription = await projectSubscription(ownerAddress, body)

    return NextResponse.json(subscription)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local-dev Growth projection failed'
    const status = message.includes('required') || message.includes('must be') ? 400 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
