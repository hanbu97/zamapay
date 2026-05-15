import type { EvmFundingAction, EvmFundingMethod, EvmPaymentIntent, SupportedEvmAsset } from '../../lib/api.ts'
import type { WalletChain } from '../../lib/wallet.ts'

export type HexAddress = `0x${string}`
export type HexValue = `0x${string}`

const settlementGasBufferNumerator = 120n
const settlementGasBufferDenominator = 100n
const settlementGasFallbacks: Record<EvmFundingMethod, bigint> = {
  eip3009: 350_000n,
  permit2: 650_000n,
  erc2612: 350_000n,
  approve_pay: 250_000n,
}
const settlementGasCeilings: Record<EvmFundingMethod, bigint> = {
  eip3009: 700_000n,
  permit2: 1_000_000n,
  erc2612: 700_000n,
  approve_pay: 500_000n,
}

export const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export const erc20PermitNonceAbi = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const erc20AllowanceAbi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export function permit2PaymentArgs(action: EvmFundingAction) {
  const args = action.authorization?.settlementArgs as
    | {
        permit2?: {
          permit2?: string
          payer?: string
          permit?: {
            permitted?: { token?: string; amount?: string }
            nonce?: string
            deadline?: string
          }
          witness?: string
          witnessTypeString?: string
        }
      }
    | null
    | undefined
  const permit2 = args?.permit2
  const permitted = permit2?.permit?.permitted
  if (
    !permit2?.permit2 ||
    !permit2.payer ||
    !permitted?.token ||
    !permitted.amount ||
    !permit2.permit?.nonce ||
    !permit2.permit.deadline ||
    !permit2.witness ||
    !permit2.witnessTypeString
  ) {
    throw new Error('Permit2 action is missing settlement arguments.')
  }

  return {
    permit2: permit2.permit2 as HexAddress,
    payer: permit2.payer as HexAddress,
    permit: {
      permitted: {
        token: permitted.token as HexAddress,
        amount: BigInt(permitted.amount),
      },
      nonce: BigInt(permit2.permit.nonce),
      deadline: BigInt(permit2.permit.deadline),
    },
    witness: permit2.witness as HexValue,
    witnessTypeString: permit2.witnessTypeString,
  }
}

export function selectBrowserFundingAction(actions: EvmFundingAction[]): EvmFundingAction | null {
  return (
    actions
      .filter((action) => !action.disabledReason)
      .sort((left, right) => left.rank - right.rank || Number(right.gasless) - Number(left.gasless))
      .find(
        (action) =>
          action.method === 'eip3009' ||
          action.method === 'permit2' ||
          action.method === 'erc2612' ||
          action.method === 'approve_pay',
      ) ??
    null
  )
}

export function evmSettlementPaymentParams(intent: EvmPaymentIntent, token: HexAddress) {
  return {
    intentId: intent.settlementIntentId as HexValue,
    projectId: intent.settlementProjectId as HexValue,
    token,
    grossAmount: BigInt(intent.expectedAmountMinorUnits),
    merchantNetAmount: BigInt(intent.merchantNetMinorUnits),
    platformFeeAmount: BigInt(intent.platformFeeMinorUnits),
    expiresAt: BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000)),
  }
}

export function addSettlementGasBuffer(estimatedGas: bigint) {
  if (estimatedGas <= 0n) {
    throw new Error('Settlement gas estimate must be positive.')
  }

  return (
    (estimatedGas * settlementGasBufferNumerator + settlementGasBufferDenominator - 1n) /
    settlementGasBufferDenominator
  )
}

export async function estimateSettlementGas(method: EvmFundingMethod, estimate: () => Promise<bigint>) {
  try {
    const buffered = addSettlementGasBuffer(await estimate())
    return buffered <= settlementGasCeilings[method] ? buffered : settlementGasFallbacks[method]
  } catch {
    return settlementGasFallbacks[method]
  }
}

export function normalizeTypedData(action: EvmFundingAction) {
  const raw = action.authorization?.typedData
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${formatFundingMethod(action.method)} does not include signing data.`)
  }
  const typedData = raw as {
    domain: Record<string, unknown>
    message: Record<string, unknown>
    primaryType: string
    types: Record<string, Array<{ name: string; type: string }>>
  }
  return {
    domain: normalizeTypedValue(typedData.domain),
    message: normalizeTypedValue(typedData.message),
    primaryType: typedData.primaryType,
    types: typedData.types,
  } as const
}

export function evmAssetWalletChain(asset: SupportedEvmAsset): WalletChain {
  return {
    id: asset.chainId,
    name: asset.network,
    nativeCurrency: {
      decimals: 18,
      name: asset.nativeSymbol,
      symbol: asset.nativeSymbol,
    },
    rpcUrls: [asset.rpcUrl],
  }
}

export async function copyEvmAddress(address: string | null | undefined, setStatus: (status: string) => void) {
  if (!address) {
    setStatus('No settlement contract is available.')
    return
  }

  try {
    await navigator.clipboard.writeText(address)
    setStatus('Settlement contract copied.')
  } catch {
    setStatus('Clipboard permission denied. Select the settlement contract and copy it manually.')
  }
}

export function formatIntentStatus(status: EvmPaymentIntent['status'] | undefined) {
  switch (status) {
    case 'confirmed':
      return 'Confirmed'
    case 'detected':
      return 'Detected'
    case 'underpaid':
      return 'Underpaid'
    case 'overpaid':
      return 'Overpaid'
    case 'expired':
      return 'Expired'
    case 'failed':
      return 'Failed'
    case 'requires_payment':
      return 'Awaiting settlement'
    default:
      return 'Unavailable'
  }
}

export function formatFundingMethod(method: string | null | undefined) {
  switch (method) {
    case 'eip3009_relayed':
      return 'EIP-3009 gasless relayer'
    case 'eip3009':
      return 'EIP-3009 authorization'
    case 'permit2_relayed':
      return 'Permit2 gasless relayer'
    case 'permit2':
      return 'Permit2 witness'
    case 'erc2612':
      return 'ERC-2612 permit'
    case 'approve_pay':
      return 'Approve and pay'
    default:
      return 'Best available'
  }
}

function normalizeTypedValue(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(normalizeTypedValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeTypedValue(entry)]))
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  return value
}
