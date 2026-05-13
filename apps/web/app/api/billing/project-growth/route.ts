import { NextResponse } from 'next/server'
import { createPublicClient, getAddress, http, isHex, parseEventLogs, type Hex } from 'viem'
import type { BillingCycle } from '@/lib/api'
import { contractEnvironmentConfig, serverContractEnvironment, type ContractEnvironmentConfig } from '@/lib/contract-environment'
import { privateSubscriptionRegistryAbi } from '@/lib/contracts'
import { postRustJson, RustApiError } from '@/lib/rust-api-transport'

type GrowthProjectionRequest = {
  billingCycle?: unknown
  finalizationTxHash?: unknown
  ownerAddress?: unknown
  plan?: unknown
}

type SubscriptionProjectionBody = {
  billingCycle: BillingCycle
  entitlementTxHash: string
  entitlementVersion: number
  passId: string
  plan: 'growth'
  subscriptionCheckHandle: string
}

type ActiveRegistry = {
  config: ContractEnvironmentConfig
  registryAddress: Hex
}

const operatorKey = process.env.ZAMAPAY_OPERATOR_KEY ?? 'local-operator-dev-key'

class RouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function billingCycle(value: unknown): BillingCycle {
  return value === 'annual' ? 'annual' : 'monthly'
}

function requiredGrowthPlan(value: unknown): 'growth' {
  if (value !== 'growth') {
    throw new RouteError('plan must be growth.', 400)
  }

  return 'growth'
}

function requiredHash(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value)) {
    throw new RouteError(`${field} must be a hex string.`, 400)
  }

  return value as Hex
}

function activeRegistry(): ActiveRegistry {
  const config = contractEnvironmentConfig(serverContractEnvironment())
  const registryAddress = config.manifest?.contracts.PrivateSubscriptionRegistry
  if (!registryAddress?.startsWith('0x')) {
    throw new RouteError(`PrivateSubscriptionRegistry is missing from the ${config.label} manifest.`, 409)
  }

  return {
    config,
    registryAddress: registryAddress as Hex,
  }
}

function publicClient(config: ContractEnvironmentConfig) {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.walletChain.rpcUrls[0]),
  })
}

async function projectSubscription(ownerAddress: string, body: SubscriptionProjectionBody) {
  try {
    return await postRustJson(`/api/operator/subscription-entitlements/${ownerAddress}/projection`, body, {
      headers: { 'x-operator-key': operatorKey },
    })
  } catch (caught) {
    if (caught instanceof RustApiError) {
      throw new RouteError(`subscription projection failed with ${caught.status}: ${caught.body}`, 502)
    }
    throw caught
  }
}

async function verifiedFinalizedGrowth(input: {
  active: ActiveRegistry
  finalizationTxHash: Hex
  ownerAddress: Hex
}) {
  const client = publicClient(input.active.config)
  const receipt = await client.getTransactionReceipt({ hash: input.finalizationTxHash }).catch(() => null)
  if (!receipt) {
    throw new RouteError('Subscription finalization transaction receipt was not found.', 404)
  }
  if (receipt.status !== 'success') {
    throw new RouteError('Subscription finalization transaction did not succeed.', 409)
  }

  const registryLogs = receipt.logs.filter((log) => log.address.toLowerCase() === input.active.registryAddress.toLowerCase())
  const finalizedLogs = parseEventLogs({
    abi: privateSubscriptionRegistryAbi,
    eventName: 'SubscriptionChangeFinalized',
    logs: registryLogs,
  })
  const finalizedLog = finalizedLogs[0]
  if (!finalizedLog) {
    throw new RouteError(`SubscriptionChangeFinalized event was not emitted by the ${input.active.config.label} registry.`, 409)
  }
  if (getAddress(finalizedLog.args.merchant) !== input.ownerAddress) {
    throw new RouteError('Subscription finalization merchant does not match the current owner.', 409)
  }
  if (!finalizedLog.args.accepted) {
    throw new RouteError('SubscriptionChangeFinalized was rejected.', 409)
  }

  const passId = finalizedLog.args.passId
  const subscriptionCheckHandle = (await client.readContract({
    address: input.active.registryAddress,
    abi: privateSubscriptionRegistryAbi,
    functionName: 'subscriptionCheckHandleOf',
    args: [passId],
  })) as Hex

  return {
    passId: passId.toString(),
    subscriptionCheckHandle,
    termsVersion: Number(finalizedLog.args.version),
  }
}

function routeFailure(caught: unknown) {
  if (caught instanceof RouteError) {
    return NextResponse.json({ error: caught.message }, { status: caught.status })
  }

  const message = caught instanceof Error ? caught.message : 'Growth projection failed.'
  return NextResponse.json({ error: message }, { status: 502 })
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => ({}))) as GrowthProjectionRequest
    if (typeof payload.ownerAddress !== 'string') {
      throw new RouteError('ownerAddress is required.', 400)
    }

    const active = activeRegistry()
    const ownerAddress = getAddress(payload.ownerAddress) as Hex
    const plan = requiredGrowthPlan(payload.plan)
    const finalized = await verifiedFinalizedGrowth({
      active,
      finalizationTxHash: requiredHash(payload.finalizationTxHash, 'finalizationTxHash'),
      ownerAddress,
    })
    const body: SubscriptionProjectionBody = {
      billingCycle: billingCycle(payload.billingCycle),
      entitlementTxHash: requiredHash(payload.finalizationTxHash, 'finalizationTxHash'),
      entitlementVersion: finalized.termsVersion,
      passId: finalized.passId,
      plan,
      subscriptionCheckHandle: finalized.subscriptionCheckHandle,
    }
    const subscription = await projectSubscription(ownerAddress, body)

    return NextResponse.json(subscription)
  } catch (caught) {
    return routeFailure(caught)
  }
}
