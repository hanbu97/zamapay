import { NextResponse } from 'next/server'
import { getAddress } from 'viem'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { upgradeLocalGrowthSubscription } from '@/lib/local-fhevm-dev'
import type { BillingCycle } from '@/lib/api'

type LocalGrowthRequest = {
  billingCycle?: unknown
  ownerAddress?: unknown
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
    canUseDevSigner({
      contractEnv: process.env.NEXT_PUBLIC_CONTRACT_ENV,
      enableDevSigner: process.env.MERMER_ENABLE_DEV_SIGNER,
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function operatorKey() {
  return process.env.MERMER_OPERATOR_KEY ?? defaultOperatorKey
}

function billingCycle(value: unknown): BillingCycle {
  return value === 'annual' ? 'annual' : 'monthly'
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
    const ownerAddress = getAddress(payload.ownerAddress)
    const cycle = billingCycle(payload.billingCycle)
    const proof = await upgradeLocalGrowthSubscription({
      billingCycle: cycle,
      ownerAddress,
    })
    const body: SubscriptionProjectionBody = {
      billingCycle: cycle,
      entitlementTxHash: proof.entitlementTxHash,
      entitlementVersion: proof.entitlementVersion,
      passId: proof.passId,
      plan: 'growth',
      subscriptionCheckHandle: proof.subscriptionCheckHandle,
    }
    const subscription = await projectSubscription(ownerAddress, body)

    return NextResponse.json(subscription)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local-dev Growth projection failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
