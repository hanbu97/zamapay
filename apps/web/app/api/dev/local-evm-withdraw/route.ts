import { NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, parseEther, toHex, type Address } from 'viem'
import { contractEnvironmentConfig, publicContractEnvironment } from '@/lib/contract-environment'
import { canUseLocalDevServerBridge } from '@/lib/dev-signer-gate'

export const runtime = 'nodejs'

type LocalEvmWithdrawRequest = {
  amountMinorUnits?: unknown
  chainId?: unknown
  receiverAddress?: unknown
  recipientAddress?: unknown
  tokenContract?: unknown
}

const erc20Abi = parseAbi(['function transfer(address to, uint256 value) returns (bool)'])

export async function POST(request: Request) {
  if (!canSubmitLocalEvmWithdraw(request)) {
    return NextResponse.json({ error: 'local ERC20 withdraw is available only for local non-production verification.' }, { status: 404 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as LocalEvmWithdrawRequest
    const config = contractEnvironmentConfig(publicContractEnvironment())
    const chainId = requiredSafeInteger(body.chainId, 'chainId')
    if (chainId !== config.walletChain.id) {
      return NextResponse.json({ error: `chainId must be ${config.walletChain.id}.` }, { status: 400 })
    }

    const amountMinorUnits = requiredSafeInteger(body.amountMinorUnits, 'amountMinorUnits')
    const receiverAddress = requiredAddress(body.receiverAddress, 'receiverAddress')
    const recipientAddress = requiredAddress(body.recipientAddress, 'recipientAddress')
    const tokenContract = requiredAddress(body.tokenContract, 'tokenContract')
    const rpcUrl = config.walletChain.rpcUrls[0]
    const publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) })
    const walletClient = createWalletClient({ chain: config.chain, transport: http(rpcUrl) })
    const requestRpc = walletClient.request as (args: { method: string; params: unknown[] }) => Promise<unknown>

    await requestRpc({ method: 'hardhat_impersonateAccount', params: [receiverAddress] })
    await requestRpc({ method: 'hardhat_setBalance', params: [receiverAddress, toHex(parseEther('1'))] })
    try {
      const chainTxHash = await walletClient.writeContract({
        abi: erc20Abi,
        account: receiverAddress,
        address: tokenContract,
        args: [recipientAddress, BigInt(amountMinorUnits)],
        functionName: 'transfer',
      })
      await publicClient.waitForTransactionReceipt({ hash: chainTxHash })

      return NextResponse.json({
        amountMinorUnits,
        chainId,
        chainTxHash,
        receiverAddress,
        recipientAddress,
        tokenContract,
      })
    } finally {
      await requestRpc({ method: 'hardhat_stopImpersonatingAccount', params: [receiverAddress] }).catch(() => undefined)
    }
  } catch (caught) {
    return NextResponse.json({ error: caught instanceof Error ? caught.message : 'Local ERC20 withdraw failed.' }, { status: 400 })
  }
}

function canSubmitLocalEvmWithdraw(request: Request): boolean {
  return canUseLocalDevServerBridge({
    contractEnv: publicContractEnvironment(),
    nodeEnv: process.env.NODE_ENV,
    requestUrl: request.url,
  })
}

function requiredAddress(value: unknown, name: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${name} must be a valid EVM address.`)
  }

  return getAddress(value)
}

function requiredSafeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`)
  }

  return value
}
