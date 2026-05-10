import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  http,
  isHex,
  type EIP1193Provider,
  type Hex,
} from 'viem'
import {
  addressManifests,
  confidentialUsdMockAbi,
  type AddressManifest,
} from '../../../../generated/clients/ts/contracts'
import type { FhevmInstance } from '@zama-fhe/relayer-sdk/web'

export type ConfidentialWalletSnapshot = {
  address: Hex
  balanceHandle: Hex
  balanceMinorUnits: string
  tokenAddress: Hex
}

export type TestTokenClaim = {
  amountMinorUnits: string
  blockNumber: string
  receiptStatus: 'success' | 'reverted'
  tokenAddress: Hex
  txHash: Hex
}

export type ChainTransactionReceipt = {
  blockNumber: string
  receiptStatus: 'success' | 'reverted'
  to: Hex | null
  txHash: Hex
}

export type WalletRpcProvider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
}

export type WalletNetwork = {
  activityLabel: string
  chainId: number
  explorerUrl: string | null
  label: string
  walletChain: {
    blockExplorerUrls?: string[]
    chainId: Hex
    chainName: string
    nativeCurrency: {
      decimals: number
      name: string
      symbol: string
    }
    rpcUrls: string[]
  }
}

type ContractEnvironment = 'local-dev' | 'sepolia'
type DecryptReadOptions = {
  onBeforeWalletSignature?: () => void
}
type RelayerSdk = typeof import('@zama-fhe/relayer-sdk/web')

const hardhatRpcUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL || 'http://127.0.0.1:8545'
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'
const selectedEnvironment = normalizeContractEnvironment(process.env.NEXT_PUBLIC_CONTRACT_ENV)
const zeroHandle = `0x${'0'.repeat(64)}` as Hex
const claimAmountMinorUnits = 1_000_000_000n
const localHardhatChain = defineChain({
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
const sepoliaChain = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Sepolia Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [sepoliaRpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Etherscan',
      url: 'https://sepolia.etherscan.io',
    },
  },
  testnet: true,
})
const environmentConfigs = {
  'local-dev': {
    activityLabel: 'Hardhat Local chain 31337',
    chain: localHardhatChain,
    environment: 'local-dev',
    explorerUrl: (process.env.NEXT_PUBLIC_LOCAL_EXPLORER_URL || '').trim() || null,
    label: 'Hardhat Local',
    manifest: addressManifests['local-dev'],
    rpcUrl: hardhatRpcUrl,
    walletChain: {
      chainId: chainIdHex(31337),
      chainName: 'Hardhat Local',
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
      },
      rpcUrls: [hardhatRpcUrl],
    },
  },
  sepolia: {
    activityLabel: 'Sepolia testnet 11155111',
    chain: sepoliaChain,
    environment: 'sepolia',
    explorerUrl: (process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_URL || 'https://sepolia.etherscan.io').trim(),
    label: 'Sepolia',
    manifest: addressManifests.sepolia,
    rpcUrl: sepoliaRpcUrl,
    walletChain: {
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
      chainId: chainIdHex(11155111),
      chainName: 'Sepolia',
      nativeCurrency: {
        decimals: 18,
        name: 'Sepolia Ether',
        symbol: 'ETH',
      },
      rpcUrls: [sepoliaRpcUrl],
    },
  },
} as const satisfies Record<
  ContractEnvironment,
  {
    activityLabel: string
    chain: typeof localHardhatChain | typeof sepoliaChain
    environment: ContractEnvironment
    explorerUrl: string | null
    label: string
    manifest: AddressManifest
    rpcUrl: string
    walletChain: WalletNetwork['walletChain']
  }
>
const activeConfig = environmentConfigs[selectedEnvironment]
const publicClient = createPublicClient({ chain: activeConfig.chain, transport: http(activeConfig.rpcUrl) })
let relayerSdkPromise: Promise<RelayerSdk> | null = null
let sepoliaInstancePromise: Promise<FhevmInstance> | null = null

export const walletNetwork: WalletNetwork = {
  activityLabel: activeConfig.activityLabel,
  chainId: activeConfig.chain.id,
  explorerUrl: activeConfig.explorerUrl,
  label: activeConfig.label,
  walletChain: activeConfig.walletChain,
}

export async function readConfidentialWallet(
  address: string,
  provider: WalletRpcProvider,
  options: DecryptReadOptions = {},
): Promise<ConfidentialWalletSnapshot> {
  const account = getAddress(address) as Hex
  const tokenAddress = activeConfig.manifest.contracts.ConfidentialUSDMock as Hex | null

  if (!tokenAddress) {
    throw new Error(`ConfidentialUSDMock is missing from the ${activeConfig.label} manifest.`)
  }

  try {
    const balanceHandle = await publicClient.readContract({
      address: tokenAddress,
      abi: confidentialUsdMockAbi,
      functionName: 'balanceOf',
      args: [account],
    })
    const balance = await decryptEuint64(balanceHandle, tokenAddress, account, provider, options)

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

export async function claimTestCusd(provider: WalletRpcProvider, address: string): Promise<TestTokenClaim> {
  const account = getAddress(address) as Hex
  const tokenAddress = activeConfig.manifest.contracts.ConfidentialUSDMock as Hex | null

  if (!tokenAddress) {
    throw new Error(`ConfidentialUSDMock is missing from the ${activeConfig.label} manifest.`)
  }

  const walletClient = createWalletClient({
    account,
    chain: activeConfig.chain,
    transport: custom(provider as EIP1193Provider),
  })
  const txHash = await walletClient.writeContract({
    account,
    address: tokenAddress,
    abi: confidentialUsdMockAbi,
    functionName: 'claimTestTokens',
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  return {
    amountMinorUnits: claimAmountMinorUnits.toString(),
    blockNumber: receipt.blockNumber.toString(),
    receiptStatus: receipt.status,
    tokenAddress,
    txHash,
  }
}

export async function prepareConfidentialWalletDecrypt(provider: WalletRpcProvider) {
  if (activeConfig.environment === 'sepolia') {
    await sepoliaInstance(provider)
  }
}

export async function readChainTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null> {
  if (activeConfig.environment === 'local-dev') {
    const receipt = await hardhatRpc<{
      blockNumber: string
      status: '0x0' | '0x1'
      to: Hex | null
      transactionHash: Hex
    } | null>('eth_getTransactionReceipt', [txHash])

    if (!receipt) {
      return null
    }

    return {
      blockNumber: BigInt(receipt.blockNumber).toString(),
      receiptStatus: receipt.status === '0x1' ? 'success' : 'reverted',
      to: receipt.to,
      txHash: receipt.transactionHash,
    }
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null)

  if (!receipt) {
    return null
  }

  return {
    blockNumber: receipt.blockNumber.toString(),
    receiptStatus: receipt.status,
    to: receipt.to,
    txHash: receipt.transactionHash as Hex,
  }
}

export function transactionExplorerHref(txHash: string): string | null {
  return activeConfig.explorerUrl ? `${activeConfig.explorerUrl.replace(/\/$/, '')}/tx/${txHash}` : null
}

export async function ensureWalletNetwork(provider: WalletRpcProvider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: activeConfig.walletChain.chainId }],
    })
  } catch (caught) {
    if (walletErrorCode(caught) !== 4902) {
      throw caught
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [activeConfig.walletChain],
    })
  }
}

async function decryptEuint64(
  handle: Hex,
  contractAddress: Hex,
  userAddress: Hex,
  provider: WalletRpcProvider,
  options: DecryptReadOptions,
): Promise<bigint> {
  if (handle === zeroHandle) {
    return 0n
  }

  if (activeConfig.environment === 'sepolia') {
    return decryptSepoliaEuint64(handle, contractAddress, userAddress, provider, options)
  }

  const values = await hardhatRpc<Hex[]>('fhevm_getClearText', [[handle]])
  const value = values[0]
  return value && value !== '0x' ? BigInt(value) : 0n
}

async function decryptSepoliaEuint64(
  handle: Hex,
  contractAddress: Hex,
  userAddress: Hex,
  provider: WalletRpcProvider,
  options: DecryptReadOptions,
): Promise<bigint> {
  const instance = await sepoliaInstance(provider)
  const keypair = instance.generateKeypair()
  const startTimestamp = Math.floor(Date.now() / 1000)
  const durationDays = 1
  const contractAddresses = [getAddress(contractAddress)]
  const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays)
  options.onBeforeWalletSignature?.()
  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [getAddress(userAddress), stringifyTypedData(eip712)],
  })
  const values = await instance.userDecrypt(
    [{ contractAddress: getAddress(contractAddress), handle }],
    keypair.privateKey,
    keypair.publicKey,
    strip0x(String(signature)),
    contractAddresses,
    getAddress(userAddress),
    startTimestamp,
    durationDays,
  )
  const value = values[handle] ?? values[handle.toLowerCase() as Hex]

  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'boolean') {
    return value ? 1n : 0n
  }
  if (typeof value === 'string' && isHex(value)) {
    return BigInt(value)
  }

  return 0n
}

function sepoliaInstance(provider: WalletRpcProvider): Promise<FhevmInstance> {
  sepoliaInstancePromise ??= relayerSdk()
    .then(async ({ SepoliaConfig, createInstance, initSDK }) => {
      await initSDK()
      return createInstance({
        ...SepoliaConfig,
        network: provider as EIP1193Provider,
      })
    })
    .catch((caught) => {
      sepoliaInstancePromise = null
      throw caught
    })

  return sepoliaInstancePromise
}

function relayerSdk() {
  relayerSdkPromise ??= import('@zama-fhe/relayer-sdk/web') as Promise<RelayerSdk>
  return relayerSdkPromise
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
    return `${activeConfig.label} RPC is not reachable at ${activeConfig.rpcUrl}. Check the selected testnet RPC before reading cUSDT.`
  }
  if (message.includes('returned no data') || message.includes('could not decode result data')) {
    return `ConfidentialUSDMock is not deployed on the current ${activeConfig.label} chain. Check the active contract manifest and refresh the page.`
  }

  return message
}

function chainIdHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex
}

function normalizeContractEnvironment(value: string | undefined): ContractEnvironment {
  switch (value) {
    case 'sepolia':
    case 'test':
    case 'testnet':
      return 'sepolia'
    default:
      return 'local-dev'
  }
}

function walletErrorCode(caught: unknown): unknown {
  return typeof caught === 'object' && caught !== null ? (caught as { code?: unknown }).code : undefined
}

function strip0x(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value
}

function stringifyTypedData(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item))
}
