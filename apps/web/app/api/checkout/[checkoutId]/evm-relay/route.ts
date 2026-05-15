import { NextResponse } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToSignature,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { EvmFundingAction, EvmPaymentActionsResponse, PublicCheckoutResponse } from '@/lib/api'
import { contractEnvironmentConfig, contractEnvironmentForChainId, publicContractEnvironment } from '@/lib/contract-environment'
import { evmCheckoutSettlementAbi } from '@/lib/contracts'
import { canUseEvmRelayer } from '@/lib/dev-signer-gate'
import { postRustJson, rustApiUrl, RustApiError } from '@/lib/rust-api-transport'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    checkoutId: string
  }>
}

type RelayRequest = {
  method?: unknown
  payerAddress?: unknown
  signature?: unknown
}

type SettlementParams = {
  intentId: Hex
  projectId: Hex
  token: Address
  grossAmount: bigint
  merchantNetAmount: bigint
  platformFeeAmount: bigint
  expiresAt: bigint
}

const DEFAULT_LOCAL_RELAYER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const relayerGasFallbacks = {
  eip3009: 350_000n,
  permit2: 650_000n,
} as const
const relayerGasCeilings = {
  eip3009: 700_000n,
  permit2: 1_000_000n,
} as const

export async function POST(request: Request, context: RouteContext) {
  if (!canSubmitEvmRelay(request)) {
    return NextResponse.json({ error: 'EVM relayer is not enabled for this environment.' }, { status: 404 })
  }

  try {
    const { checkoutId } = await context.params
    const body = (await request.json().catch(() => ({}))) as RelayRequest
    const method = relayMethod(body.method)
    const payerAddress = requiredAddress(body.payerAddress, 'payerAddress')
    const signature = requiredSignature(body.signature)
    const checkout = await getRustJson<PublicCheckoutResponse>(`/api/checkout/${encodeURIComponent(checkoutId)}`)
    if (!checkout.evmPaymentIntent || !checkout.evmAsset) {
      return NextResponse.json({ error: 'checkout is not an evm_erc20 payment.' }, { status: 400 })
    }

    const actions = await postRustJson<EvmPaymentActionsResponse>(
      `/api/checkout/${encodeURIComponent(checkoutId)}/evm-payment-actions`,
      { payerAddress },
    )
    if (actions.chainId !== checkout.evmAsset.chainId) {
      return NextResponse.json({ error: 'checkout asset and payment action chain mismatch.' }, { status: 409 })
    }

    const action = actions.actions.find((candidate) => candidate.method === method)
    if (!action || action.disabledReason) {
      return NextResponse.json({ error: action?.disabledReason ?? 'requested relayer action is not available.' }, { status: 400 })
    }
    if (!action.gasless) {
      return NextResponse.json({ error: 'requested action is not relayer-backed.' }, { status: 400 })
    }

    const environment = contractEnvironmentForChainId(actions.chainId)
    if (!environment) {
      return NextResponse.json({ error: `No runtime profile for chain ${actions.chainId}.` }, { status: 400 })
    }
    const config = contractEnvironmentConfig(environment)
    if (config.chain.id !== actions.chainId) {
      return NextResponse.json({ error: `Runtime profile chain ${config.chain.id} does not match checkout chain ${actions.chainId}.` }, { status: 409 })
    }

    const account = privateKeyToAccount(evmRelayerPrivateKey(request))
    const publicClient = createPublicClient({ chain: config.chain, transport: http(checkout.evmAsset.rpcUrl) })
    const walletClient = createWalletClient({ account, chain: config.chain, transport: http(checkout.evmAsset.rpcUrl) })
    const settlement = requiredAddress(actions.settlementContract, 'settlementContract')

    const txHash =
      method === 'eip3009'
        ? await relayEip3009Payment({
            action,
            payerAddress,
            publicClient,
            relayerAddress: account.address,
            settlement,
            signature,
            walletClient,
          })
        : await relayPermit2Payment({
            action,
            payerAddress,
            publicClient,
            relayerAddress: account.address,
            settlement,
            signature,
            walletClient,
          })
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    return NextResponse.json({
      blockNumber: Number(receipt.blockNumber),
      chainId: actions.chainId,
      checkoutId,
      chainTxHash: txHash,
      gasUsed: receipt.gasUsed.toString(),
      method,
      relayerAddress: account.address,
      status: receipt.status,
    })
  } catch (caught) {
    if (caught instanceof RustApiError) {
      return NextResponse.json({ error: caught.body || caught.message }, { status: caught.status })
    }

    return NextResponse.json({ error: caught instanceof Error ? caught.message : 'EVM relayer submission failed.' }, { status: 400 })
  }
}

async function relayEip3009Payment(input: RelayPaymentInput) {
  const typedData = typedAuthorization(input.action)
  const args = settlementArgs(input.action)
  const params = settlementParams(args.params)
  const from = requiredAddress(typedData.message.from, 'typedData.from')
  const to = requiredAddress(typedData.message.to, 'typedData.to')
  const value = requiredBigInt(typedData.message.value, 'typedData.value')
  assertSameAddress(from, input.payerAddress, 'typedData.from')
  assertSameAddress(to, input.settlement, 'typedData.to')
  assertSameBigInt(value, params.grossAmount, 'typedData.value')

  const split = hexToSignature(input.signature)
  const authorization = {
    nonce: requiredBytes32(typedData.message.nonce, 'nonce'),
    payer: from,
    r: split.r,
    s: split.s,
    v: Number(split.v),
    validAfter: requiredBigInt(typedData.message.validAfter, 'validAfter'),
    validBefore: requiredBigInt(typedData.message.validBefore, 'validBefore'),
  }
  const gas = await relayerGas('eip3009', () =>
    input.publicClient.estimateContractGas({
      account: input.relayerAddress,
      address: input.settlement,
      abi: evmCheckoutSettlementAbi,
      functionName: 'payWithAuthorization',
      args: [params, authorization],
    }),
  )

  return input.walletClient.writeContract({
    account: input.relayerAddress,
    address: input.settlement,
    abi: evmCheckoutSettlementAbi,
    chain: null,
    functionName: 'payWithAuthorization',
    gas,
    args: [params, authorization],
  })
}

async function relayPermit2Payment(input: RelayPaymentInput) {
  const args = settlementArgs(input.action)
  const params = settlementParams(args.params)
  const permit2 = permit2Args(args.permit2, input.signature)
  assertSameAddress(permit2.payer, input.payerAddress, 'permit2.payer')
  assertSameAddress(permit2.permit.permitted.token, params.token, 'permit2.permitted.token')
  assertSameBigInt(permit2.permit.permitted.amount, params.grossAmount, 'permit2.permitted.amount')

  const gas = await relayerGas('permit2', () =>
    input.publicClient.estimateContractGas({
      account: input.relayerAddress,
      address: input.settlement,
      abi: evmCheckoutSettlementAbi,
      functionName: 'payWithPermit2',
      args: [params, permit2],
    }),
  )

  return input.walletClient.writeContract({
    account: input.relayerAddress,
    address: input.settlement,
    abi: evmCheckoutSettlementAbi,
    chain: null,
    functionName: 'payWithPermit2',
    gas,
    args: [params, permit2],
  })
}

type RelayPaymentInput = {
  action: EvmFundingAction
  payerAddress: Address
  publicClient: ReturnType<typeof createPublicClient>
  relayerAddress: Address
  settlement: Address
  signature: Hex
  walletClient: ReturnType<typeof createWalletClient>
}

function canSubmitEvmRelay(request: Request): boolean {
  return canUseEvmRelayer({
    contractEnv: publicContractEnvironment(),
    enableRelayer: process.env.ZAMAPAY_ENABLE_EVM_RELAYER,
    nodeEnv: process.env.NODE_ENV,
    requestUrl: request.url,
  })
}

function evmRelayerPrivateKey(request: Request): Hex {
  const local = publicContractEnvironment() === 'local-dev' && new URL(request.url).hostname.match(/^(127\.0\.0\.1|localhost)$/)
  const value = process.env.ZAMAPAY_EVM_RELAYER_PRIVATE_KEY || (local ? DEFAULT_LOCAL_RELAYER_PRIVATE_KEY : '')
  if (!value.startsWith('0x') || value.length !== 66) {
    throw new Error('ZAMAPAY_EVM_RELAYER_PRIVATE_KEY must be a 32-byte private key.')
  }

  return value as Hex
}

async function getRustJson<T>(pathname: string): Promise<T> {
  const response = await fetch(rustApiUrl(pathname), { cache: 'no-store' })
  const text = await response.text()
  if (!response.ok) {
    throw new RustApiError(pathname, response.status, text)
  }

  return JSON.parse(text) as T
}

function relayMethod(value: unknown): 'eip3009' | 'permit2' {
  if (value === 'eip3009' || value === 'permit2') {
    return value
  }

  throw new Error('method must be eip3009 or permit2.')
}

function typedAuthorization(action: EvmFundingAction) {
  const typedData = action.authorization?.typedData
  if (!typedData || typeof typedData !== 'object') {
    throw new Error('relayed action is missing typed data.')
  }

  return typedData as { message: Record<string, unknown> }
}

function settlementArgs(action: EvmFundingAction) {
  const args = action.authorization?.settlementArgs
  if (!args || typeof args !== 'object') {
    throw new Error('relayed action is missing settlement arguments.')
  }

  return args as { params?: unknown; permit2?: unknown }
}

function settlementParams(value: unknown): SettlementParams {
  const params = requiredRecord(value, 'params')

  return {
    expiresAt: requiredBigInt(params.expiresAt, 'expiresAt'),
    grossAmount: requiredBigInt(params.grossAmount, 'grossAmount'),
    intentId: requiredBytes32(params.intentId, 'intentId'),
    merchantNetAmount: requiredBigInt(params.merchantNetAmount, 'merchantNetAmount'),
    platformFeeAmount: requiredBigInt(params.platformFeeAmount, 'platformFeeAmount'),
    projectId: requiredBytes32(params.projectId, 'projectId'),
    token: requiredAddress(params.token, 'token'),
  }
}

function permit2Args(value: unknown, signature: Hex) {
  const permit2 = requiredRecord(value, 'permit2')
  const permit = requiredRecord(permit2.permit, 'permit2.permit')
  const permitted = requiredRecord(permit.permitted, 'permit2.permit.permitted')

  return {
    payer: requiredAddress(permit2.payer, 'permit2.payer'),
    permit: {
      deadline: requiredBigInt(permit.deadline, 'permit2.permit.deadline'),
      nonce: requiredBigInt(permit.nonce, 'permit2.permit.nonce'),
      permitted: {
        amount: requiredBigInt(permitted.amount, 'permit2.permit.permitted.amount'),
        token: requiredAddress(permitted.token, 'permit2.permit.permitted.token'),
      },
    },
    permit2: requiredAddress(permit2.permit2, 'permit2.permit2'),
    signature,
    witness: requiredBytes32(permit2.witness, 'permit2.witness'),
    witnessTypeString: requiredString(permit2.witnessTypeString, 'permit2.witnessTypeString'),
  }
}

async function relayerGas(method: 'eip3009' | 'permit2', estimate: () => Promise<bigint>) {
  try {
    const gas = await estimate()
    const buffered = (gas * 120n + 99n) / 100n
    return buffered <= relayerGasCeilings[method] ? buffered : relayerGasFallbacks[method]
  } catch {
    return relayerGasFallbacks[method]
  }
}

function requiredAddress(value: unknown, name: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`)
  }

  return getAddress(value)
}

function requiredBytes32(value: unknown, name: string): Hex {
  if (
    typeof value !== 'string' ||
    value.length !== 66 ||
    !value.startsWith('0x') ||
    !/^[0-9a-fA-F]+$/u.test(value.slice(2))
  ) {
    throw new Error(`${name} must be a bytes32 hex value.`)
  }

  return value as Hex
}

function requiredSignature(value: unknown): Hex {
  if (
    typeof value !== 'string' ||
    value.length !== 132 ||
    !value.startsWith('0x') ||
    !/^[0-9a-fA-F]+$/u.test(value.slice(2))
  ) {
    throw new Error('signature must be a 65-byte hex value.')
  }

  return value as Hex
}

function requiredBigInt(value: unknown, name: string): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return BigInt(value)
  }

  throw new Error(`${name} must be an unsigned integer.`)
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`)
  }

  return value
}

function requiredRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`)
  }

  return value as Record<string, unknown>
}

function assertSameAddress(actual: Address, expected: Address, name: string): void {
  if (actual !== expected) {
    throw new Error(`${name} does not match this payment intent.`)
  }
}

function assertSameBigInt(actual: bigint, expected: bigint, name: string): void {
  if (actual !== expected) {
    throw new Error(`${name} does not match this payment intent.`)
  }
}
