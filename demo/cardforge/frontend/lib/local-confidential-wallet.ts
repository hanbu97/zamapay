import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import localDevManifest from '../../../../generated/contracts/addresses/local-dev.json'

export type ConfidentialWalletSnapshot = {
  address: Hex
  balanceHandle: Hex
  balanceMinorUnits: string
  tokenAddress: Hex
}

export type TestTokenClaim = {
  amountMinorUnits: string
  tokenAddress: Hex
  txHash: Hex
}

type WalletRpcProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

const hardhatRpcUrl = 'http://127.0.0.1:8545'
const zeroHandle = `0x${'0'.repeat(64)}` as Hex
const hardhatLocalChain = defineChain({
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [hardhatRpcUrl] },
  },
})
const publicClient = createPublicClient({ chain: hardhatLocalChain, transport: http(hardhatRpcUrl) })
const confidentialTokenAbi = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'claimTestTokens',
    outputs: [{ type: 'uint64' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const
const claimAmountMinorUnits = 1_000_000_000n

export async function readConfidentialWallet(address: string): Promise<ConfidentialWalletSnapshot> {
  const account = getAddress(address) as Hex
  const tokenAddress = localDevManifest.contracts.ConfidentialUSDMock as Hex | null

  if (!tokenAddress) {
    throw new Error('ConfidentialUSDMock is missing from the local-dev manifest.')
  }

  try {
    const balanceHandle = await publicClient.readContract({
      address: tokenAddress,
      abi: confidentialTokenAbi,
      functionName: 'balanceOf',
      args: [account],
    })
    const balance = await decryptLocalEuint64(balanceHandle)

    return {
      address: account,
      balanceHandle,
      balanceMinorUnits: balance.toString(),
      tokenAddress,
    }
  } catch (caught) {
    throw new Error(readableRpcError(caught))
  }
}

export async function claimLocalTestCusd(provider: WalletRpcProvider, address: string): Promise<TestTokenClaim> {
  const account = getAddress(address) as Hex
  const tokenAddress = localDevManifest.contracts.ConfidentialUSDMock as Hex | null

  if (!tokenAddress) {
    throw new Error('ConfidentialUSDMock is missing from the local-dev manifest.')
  }

  const walletClient = createWalletClient({
    account,
    chain: hardhatLocalChain,
    transport: custom(provider as EIP1193Provider),
  })
  const txHash = await walletClient.writeContract({
    account,
    address: tokenAddress,
    abi: confidentialTokenAbi,
    functionName: 'claimTestTokens',
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  return {
    amountMinorUnits: claimAmountMinorUnits.toString(),
    tokenAddress,
    txHash,
  }
}

async function decryptLocalEuint64(handle: Hex): Promise<bigint> {
  if (handle === zeroHandle) {
    return 0n
  }

  const values = await hardhatRpc<Hex[]>('fhevm_getClearText', [[handle]])
  const value = values[0]
  return value && value !== '0x' ? BigInt(value) : 0n
}

async function hardhatRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(hardhatRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: '2.0',
      method,
      params,
    }),
  })
  const body = (await response.json()) as { error?: { message?: string }; result?: T }

  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Hardhat RPC ${method} failed with ${response.status}.`)
  }
  if (body.result === undefined) {
    throw new Error(`Hardhat RPC ${method} returned no result.`)
  }

  return body.result
}

function readableRpcError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught)
  if (message.includes('HTTP request failed') || message.includes('fetch failed')) {
    return `Hardhat Local RPC is not reachable at ${hardhatRpcUrl}. Start the local chain and deploy contracts before reading cUSDT.`
  }
  if (message.includes('returned no data') || message.includes('could not decode result data')) {
    return 'ConfidentialUSDMock is not deployed on the current Hardhat Local chain. Redeploy local contracts and refresh the page.'
  }

  return message
}
