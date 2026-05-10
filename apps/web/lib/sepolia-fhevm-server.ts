import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isHex,
  keccak256,
  toBytes,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { privateCheckoutSettlementAbi, sepolia, sepoliaAddresses } from './contracts.ts'
import { settlementBucketCommitment } from './settlement-bucket.ts'

type RelayerEncryptedInputBuilder = {
  add64(value: bigint): RelayerEncryptedInputBuilder
  encrypt(): Promise<{
    handles: Array<Uint8Array | string>
    inputProof: Uint8Array | string
  }>
}

type RelayerInstance = {
  createEncryptedInput(contractAddress: string, userAddress: string): RelayerEncryptedInputBuilder
}

type RelayerSdk = {
  SepoliaConfig: Record<string, unknown>
  createInstance(config: Record<string, unknown>): Promise<RelayerInstance>
}

export type SepoliaChainInvoice = {
  chainInvoiceId: number
  chainTxHash: Hex
  expiresAt: number
  orderCommitment: Hex
  settlementBucketCommitment: Hex
  settlementAddress: Hex
  tokenAddress: Hex
}

let instancePromise: Promise<RelayerInstance> | null = null

export async function createSepoliaChainInvoice(input: {
  amountMinorUnits: bigint
  expiresInSeconds?: number
  externalRef: string
  merchantNetMinorUnits: bigint
  merchantOwnerAddress: string
  platformFeeMinorUnits: bigint
  settlementBucketSeed: string
}): Promise<SepoliaChainInvoice> {
  return createSepoliaChainInvoiceInNode(input)
}

export async function createSepoliaChainInvoiceDirect(input: {
  amountMinorUnits: bigint
  expiresInSeconds?: number
  externalRef: string
  merchantNetMinorUnits: bigint
  merchantOwnerAddress: string
  platformFeeMinorUnits: bigint
  settlementBucketSeed: string
}): Promise<SepoliaChainInvoice> {
  validateInvoiceInput(input)

  const settlementAddress = sepoliaAddresses?.contracts.PrivateCheckoutSettlement
  const tokenAddress = sepoliaAddresses?.contracts.ConfidentialUSDMock
  if (!settlementAddress || !tokenAddress) {
    throw new Error('Sepolia private checkout contracts are not deployed.')
  }

  const rpcUrl = sepoliaRpcUrl()
  const account = privateKeyToAccount(chainInvoicePrivateKey())
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  })
  const checkoutCreator = await publicClient.readContract({
    address: settlementAddress,
    abi: privateCheckoutSettlementAbi,
    functionName: 'checkoutCreator',
  })
  if (getAddress(checkoutCreator) !== getAddress(account.address)) {
    throw new Error('Sepolia chain invoice signer is not the settlement checkout creator.')
  }

  const expiresAt = Math.floor(Date.now() / 1000) + (input.expiresInSeconds ?? 3600)
  const orderCommitment = sepoliaCommitment(
    'order',
    input.externalRef.trim(),
    input.amountMinorUnits.toString(),
    expiresAt.toString(),
  )
  const bucketCommitment = settlementBucketCommitment(input.settlementBucketSeed.trim())
  const encryptedAmounts = await encryptSepoliaCheckoutAmounts({
    amountMinorUnits: input.amountMinorUnits,
    contractAddress: settlementAddress,
    merchantNetMinorUnits: input.merchantNetMinorUnits,
    platformFeeMinorUnits: input.platformFeeMinorUnits,
    userAddress: account.address,
  })
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  })
  const chainTxHash = await walletClient.writeContract({
    address: settlementAddress,
    abi: privateCheckoutSettlementAbi,
    functionName: 'createPrivateCheckout',
    args: [
      orderCommitment,
      bucketCommitment,
      ownerAddressCommitment(bucketCommitment, input.merchantOwnerAddress),
      encryptedAmounts.expectedAmountHandle,
      encryptedAmounts.merchantNetAmountHandle,
      encryptedAmounts.platformFeeAmountHandle,
      encryptedAmounts.inputProof,
      BigInt(expiresAt),
    ],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: chainTxHash })
  if (receipt.status !== 'success') {
    throw new Error('Sepolia private checkout transaction reverted.')
  }

  const checkoutId = Number(
    await publicClient.readContract({
      address: settlementAddress,
      abi: privateCheckoutSettlementAbi,
      functionName: 'checkoutIdOf',
      args: [orderCommitment],
    }),
  )
  if (!Number.isSafeInteger(checkoutId)) {
    throw new Error('Sepolia private checkout id is outside the safe integer range.')
  }

  return {
    chainInvoiceId: checkoutId,
    chainTxHash,
    expiresAt,
    orderCommitment,
    settlementBucketCommitment: bucketCommitment,
    settlementAddress,
    tokenAddress,
  }
}

async function createSepoliaChainInvoiceInNode(input: {
  amountMinorUnits: bigint
  expiresInSeconds?: number
  externalRef: string
  merchantNetMinorUnits: bigint
  merchantOwnerAddress: string
  platformFeeMinorUnits: bigint
  settlementBucketSeed: string
}): Promise<SepoliaChainInvoice> {
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'create-sepolia-chain-invoice.mjs')
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []

  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
  child.stdin.end(
    JSON.stringify({
      amountMinorUnits: input.amountMinorUnits.toString(),
      expiresInSeconds: input.expiresInSeconds,
      externalRef: input.externalRef,
      merchantNetMinorUnits: input.merchantNetMinorUnits.toString(),
      merchantOwnerAddress: input.merchantOwnerAddress,
      platformFeeMinorUnits: input.platformFeeMinorUnits.toString(),
      settlementBucketSeed: input.settlementBucketSeed,
    }),
  )

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  const output = Buffer.concat(stdout).toString('utf8').trim()
  const errorOutput = Buffer.concat(stderr).toString('utf8').trim()

  if (exitCode !== 0) {
    throw new Error(errorOutput || output || `Sepolia chain invoice worker exited with ${exitCode}.`)
  }

  try {
    return JSON.parse(output) as SepoliaChainInvoice
  } catch {
    throw new Error(errorOutput || 'Sepolia chain invoice worker returned invalid JSON.')
  }
}

function validateInvoiceInput(input: {
  amountMinorUnits: bigint
  externalRef: string
  merchantNetMinorUnits: bigint
  merchantOwnerAddress: string
  platformFeeMinorUnits: bigint
  settlementBucketSeed: string
}) {
  if (input.amountMinorUnits <= 0n) {
    throw new Error('Sepolia chain invoice amount must be greater than zero.')
  }
  if (!input.externalRef.trim()) {
    throw new Error('Sepolia chain invoice externalRef is required.')
  }
  if (!input.settlementBucketSeed.trim()) {
    throw new Error('Sepolia chain invoice settlementBucketSeed is required.')
  }
  if (!isAddress(input.merchantOwnerAddress)) {
    throw new Error('Sepolia chain invoice merchantOwnerAddress must be a valid EVM address.')
  }
  if (input.merchantNetMinorUnits <= 0n || input.platformFeeMinorUnits < 0n) {
    throw new Error('Sepolia chain invoice billing split is invalid.')
  }
  if (input.merchantNetMinorUnits + input.platformFeeMinorUnits !== input.amountMinorUnits) {
    throw new Error('Sepolia chain invoice billing split must equal the gross amount.')
  }
}

async function encryptSepoliaCheckoutAmounts(input: {
  amountMinorUnits: bigint
  contractAddress: Hex
  merchantNetMinorUnits: bigint
  platformFeeMinorUnits: bigint
  userAddress: Hex
}): Promise<{
  expectedAmountHandle: Hex
  inputProof: Hex
  merchantNetAmountHandle: Hex
  platformFeeAmountHandle: Hex
}> {
  const instance = await sepoliaInstance()
  const encrypted = await instance
    .createEncryptedInput(getAddress(input.contractAddress), getAddress(input.userAddress))
    .add64(input.amountMinorUnits)
    .add64(input.merchantNetMinorUnits)
    .add64(input.platformFeeMinorUnits)
    .encrypt()

  return {
    expectedAmountHandle: toHexValue(encrypted.handles[0], 'encrypted expected amount handle'),
    merchantNetAmountHandle: toHexValue(encrypted.handles[1], 'encrypted merchant net amount handle'),
    platformFeeAmountHandle: toHexValue(encrypted.handles[2], 'encrypted platform fee amount handle'),
    inputProof: toHexValue(encrypted.inputProof, 'encrypted amount input proof'),
  }
}

async function sepoliaInstance(): Promise<RelayerInstance> {
  instancePromise ??= import('@zama-fhe/relayer-sdk/node').then(async ({ SepoliaConfig, createInstance }) => {
    return createInstance({
      ...SepoliaConfig,
      network: sepoliaRpcUrl(),
    })
  }) as Promise<RelayerInstance>

  return instancePromise
}

function chainInvoicePrivateKey(): Hex {
  const raw =
    process.env.ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  const normalized = raw?.startsWith('0x') ? raw : raw ? `0x${raw}` : ''
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY must be a 32-byte Sepolia private key.')
  }

  return normalized as Hex
}

function sepoliaRpcUrl(): string {
  const configured = process.env.SEPOLIA_RPC_URL ?? process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL
  if (configured?.trim() && !configured.includes('replace-with')) {
    return configured.trim()
  }

  return 'https://ethereum-sepolia-rpc.publicnode.com'
}

function sepoliaCommitment(...parts: string[]): Hex {
  return keccak256(toBytes(`zamapay:sepolia:${parts.join(':')}`))
}

function ownerAddressCommitment(settlementBucketCommitment: Hex, address: string): Hex {
  return keccak256(`${settlementBucketCommitment}${getAddress(address).slice(2)}` as Hex)
}

function toHexValue(value: Uint8Array | string | undefined, label: string): Hex {
  const hex = typeof value === 'string' ? value : value ? bytesToHex(value) : ''
  if (!isHex(hex)) {
    throw new Error(`Sepolia relayer returned an invalid ${label}.`)
  }

  return hex
}
