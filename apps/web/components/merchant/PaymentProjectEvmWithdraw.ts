import type { ProjectDashboardOverview } from '@/lib/api'

type LocalProjectEvmWithdrawInput = {
  amountMinorUnits: number
  overview: ProjectDashboardOverview
  recipientAddress: string
  setStatus: (status: string) => void
}

export type LocalProjectEvmWithdrawSubmission = {
  amountMinorUnits: number
  chainId: number
  chainTxHash: string
  receiverAddress: string
  recipientAddress: string
  settlementContract: string
  settlementProjectId: string
  tokenContract: string
  withdrawalId: string
}

export function localProjectEvmWithdrawAsset(overview: ProjectDashboardOverview, amountMinorUnits: number) {
  return (
    overview.evmAssetBalances.find((balance) => balance.withdrawableMinorUnits >= amountMinorUnits) ??
    null
  )
}

export async function runLocalProjectEvmWithdraw(
  input: LocalProjectEvmWithdrawInput,
): Promise<LocalProjectEvmWithdrawSubmission> {
  const asset = localProjectEvmWithdrawAsset(input.overview, input.amountMinorUnits)
  if (!asset) {
    throw new Error('No local ERC20 settlement balance can satisfy this withdraw.')
  }

  const settlementIntent = input.overview.evmPaymentIntents.find(
    (intent) =>
      intent.chainId === asset.chainId &&
      intent.tokenContract.toLowerCase() === asset.tokenContract.toLowerCase(),
  )
  const settlementContract = settlementIntent?.settlementContract ?? input.overview.supportedEvmAssets.find(
    (supported) =>
      supported.chainId === asset.chainId &&
      supported.tokenContract.toLowerCase() === asset.tokenContract.toLowerCase(),
  )?.settlementContract
  if (!settlementContract || !settlementIntent?.settlementProjectId) {
    throw new Error('No local ERC20 settlement contract is available for this withdraw.')
  }

  input.setStatus('Submitting local ERC20 settlement withdraw...')
  const response = await fetch('/api/dev/local-evm-withdraw', {
    body: JSON.stringify({
      amountMinorUnits: input.amountMinorUnits,
      chainId: asset.chainId,
      recipientAddress: input.recipientAddress,
      settlementContract,
      settlementProjectId: settlementIntent.settlementProjectId,
      tokenContract: asset.tokenContract,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json().catch(() => ({}))) as { error?: unknown } & LocalProjectEvmWithdrawSubmission
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : 'Local ERC20 withdraw failed.')
  }

  return body
}
