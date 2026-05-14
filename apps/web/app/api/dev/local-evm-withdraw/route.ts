import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createPublicClient, createWalletClient, getAddress, http, isAddress, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { contractEnvironmentConfig, publicContractEnvironment } from '@/lib/contract-environment'
import { canUseLocalDevServerBridge } from '@/lib/dev-signer-gate'

export const runtime = 'nodejs'

type LocalEvmWithdrawRequest = {
  amountMinorUnits?: unknown
  chainId?: unknown
  recipientAddress?: unknown
  settlementContract?: unknown
  settlementProjectId?: unknown
  tokenContract?: unknown
}

const DEFAULT_LOCAL_WITHDRAW_AUTHORIZER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const settlementAbi = parseAbi([
  'function withdrawMerchant(bytes32 projectId, address token, address recipient, uint256 amount, bytes32 withdrawalId, uint256 deadline, bytes signature)',
])

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
    const recipientAddress = requiredAddress(body.recipientAddress, 'recipientAddress')
    const settlementContract = requiredAddress(body.settlementContract, 'settlementContract')
    const settlementProjectId = requiredBytes32(body.settlementProjectId, 'settlementProjectId')
    const tokenContract = requiredAddress(body.tokenContract, 'tokenContract')
    const rpcUrl = config.walletChain.rpcUrls[0]
    const account = privateKeyToAccount(localWithdrawAuthorizerPrivateKey())
    const publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) })
    const walletClient = createWalletClient({ account, chain: config.chain, transport: http(rpcUrl) })
    const latestBlock = await publicClient.getBlock()
    const deadline = BigInt(Number(latestBlock.timestamp) + 3600)
    const withdrawalId = randomBytes32()
    const signature = await account.signTypedData({
      domain: {
        chainId: config.walletChain.id,
        name: 'ZamaPayEvmCheckoutSettlement',
        verifyingContract: settlementContract,
        version: '1',
      },
      primaryType: 'EvmWithdraw',
      types: {
        EvmWithdraw: [
          { name: 'projectId', type: 'bytes32' },
          { name: 'token', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'withdrawalId', type: 'bytes32' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      message: {
        amount: BigInt(amountMinorUnits),
        deadline,
        projectId: settlementProjectId,
        recipient: recipientAddress,
        token: tokenContract,
        withdrawalId,
      },
    })
    const chainTxHash = await walletClient.writeContract({
      abi: settlementAbi,
      address: settlementContract,
      args: [
        settlementProjectId,
        tokenContract,
        recipientAddress,
        BigInt(amountMinorUnits),
        withdrawalId,
        deadline,
        signature,
      ],
      functionName: 'withdrawMerchant',
    })
    await publicClient.waitForTransactionReceipt({ hash: chainTxHash })

    return NextResponse.json({
      amountMinorUnits,
      chainId,
      chainTxHash,
      receiverAddress: settlementContract,
      recipientAddress,
      settlementContract,
      settlementProjectId,
      tokenContract,
      withdrawalId,
    })
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

function requiredBytes32(value: unknown, name: string): Hex {
  if (
    typeof value !== 'string' ||
    value.length !== 66 ||
    !value.startsWith('0x') ||
    !/^[0-9a-fA-F]+$/.test(value.slice(2))
  ) {
    throw new Error(`${name} must be a bytes32 hex value.`)
  }

  return value as Hex
}

function requiredSafeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`)
  }

  return value
}

function localWithdrawAuthorizerPrivateKey(): Hex {
  const value =
    process.env.ZAMAPAY_LOCAL_EVM_WITHDRAW_AUTHORIZER_PRIVATE_KEY ??
    process.env.ZAMAPAY_LOCAL_EVM_SUBMITTER_PRIVATE_KEY ??
    DEFAULT_LOCAL_WITHDRAW_AUTHORIZER_PRIVATE_KEY
  if (!value.startsWith('0x') || value.length !== 66) {
    throw new Error('ZAMAPAY_LOCAL_EVM_WITHDRAW_AUTHORIZER_PRIVATE_KEY must be a 32-byte private key.')
  }

  return value as Hex
}

function randomBytes32(): Hex {
  return `0x${randomBytes(32).toString('hex')}`
}
