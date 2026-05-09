import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToHex, getAddress, keccak256, toBytes, type Hex } from 'viem'
import { localDevAddresses } from './contracts.ts'

type HardhatRuntime = {
  ethers: {
    getContractAt(name: string, address: string, signer?: unknown): Promise<unknown>
    getSigners(): Promise<unknown[]>
  }
  fhevm: {
    initializeCLIApi(): Promise<void>
    createEncryptedInput(contractAddress: string, userAddress: string): {
      add16(value: bigint): void
      add64(value: bigint): void
      encrypt(): Promise<{ handles: unknown[]; inputProof: unknown }>
    }
    publicDecrypt(handles: (string | Uint8Array)[]): Promise<{
      abiEncodedClearValues: unknown
      clearValues: Record<string, unknown>
      decryptionProof: unknown
    }>
  }
}

type LocalSigner = {
  getAddress(): Promise<string>
}

type LocalTx = {
  hash: Hex
  wait(): Promise<LocalTxReceipt | null>
}

type LocalTxReceipt = {
  logs: readonly unknown[]
}

type LocalPrivateCheckoutSettlement = {
  checkoutIdOf(orderCommitment: Hex): Promise<unknown>
  createPrivateCheckout(
    orderCommitment: Hex,
    settlementBucketCommitment: Hex,
    encryptedExpectedAmount: Hex,
    inputProof: Hex,
    expiresAt: bigint,
  ): Promise<LocalTx>
  finalizePrivatePayment(orderCommitment: Hex, abiEncodedPaymentAccepted: Hex, decryptionProof: Hex): Promise<LocalTx>
  orderCommitmentOf(checkoutId: bigint): Promise<unknown>
  paymentCheckHandleOf(orderCommitment: Hex): Promise<unknown>
  statusOf(orderCommitment: Hex): Promise<unknown>
}

type LocalEncryptedInput = {
  handle: Hex
  inputProof: Hex
}

export type LocalChainInvoice = {
  chainInvoiceId: number
  chainTxHash: Hex
  expiresAt: number
  orderCommitment?: Hex
  settlementBucketCommitment?: Hex
  settlementAddress: Hex
  tokenAddress?: Hex
}

export type LocalFinalizedPayment = {
  accepted: boolean
  chainInvoiceId: number
  orderCommitment: Hex
  payerAddress: Hex
  paymentTxHash: Hex
}

const checkoutStatus = {
  accepted: 3n,
  created: 1n,
  expired: 5n,
  rejected: 4n,
  submitted: 2n,
} as const

let hardhatPromise: Promise<{ hre: HardhatRuntime }> | null = null
let localOperationQueue: Promise<void> = Promise.resolve()

export async function createLocalChainInvoice(input: {
  amountMinorUnits: bigint
  expiresInSeconds?: number
  externalRef: string
}): Promise<LocalChainInvoice> {
  return runExclusiveLocalFhevm(async () => {
    if (input.amountMinorUnits <= 0n) {
      throw new Error('Local chain invoice amount must be greater than zero.')
    }

    const externalRef = input.externalRef.trim()
    if (!externalRef) {
      throw new Error('Local chain invoice externalRef is required.')
    }

    const settlementAddress = localDevAddresses.contracts.PrivateCheckoutSettlement
    const tokenAddress = localDevAddresses.contracts.ConfidentialUSDMock
    if (!settlementAddress || !tokenAddress) {
      throw new Error('local-dev private checkout contracts are not deployed.')
    }

    const { hre } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const creator = signers[0] as LocalSigner | undefined
    if (!creator) {
      throw new Error('No local Hardhat signer is available to create the private checkout.')
    }

    const creatorAddress = getAddress(await creator.getAddress()) as Hex
    const settlement = (await hre.ethers.getContractAt(
      'PrivateCheckoutSettlement',
      settlementAddress,
      creator,
    )) as LocalPrivateCheckoutSettlement
    const expiresInSeconds = input.expiresInSeconds ?? 3600
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    const orderCommitment = localCommitment('order', externalRef, input.amountMinorUnits.toString(), expiresAt.toString())
    const settlementBucketCommitment = localCommitment(
      'settlement-bucket',
      externalRef,
      input.amountMinorUnits.toString(),
      expiresAt.toString(),
    )
    const encryptedExpectedAmount = await encryptLocal64(hre, {
      amountMinorUnits: input.amountMinorUnits,
      contractAddress: settlementAddress,
      userAddress: creatorAddress,
    })
    const tx = await settlement.createPrivateCheckout(
      orderCommitment,
      settlementBucketCommitment,
      encryptedExpectedAmount.handle,
      encryptedExpectedAmount.inputProof,
      BigInt(expiresAt),
    )
    const receipt = await tx.wait()
    if (!receipt) {
      throw new Error('Local private checkout transaction was not mined.')
    }
    const checkoutId = Number(chainValueToBigInt(await settlement.checkoutIdOf(orderCommitment)))
    if (!Number.isSafeInteger(checkoutId)) {
      throw new Error('Private checkout id is outside the safe integer range.')
    }

    return {
      chainInvoiceId: checkoutId,
      chainTxHash: toHex(tx.hash, 'invoice transaction hash'),
      expiresAt,
      orderCommitment,
      settlementBucketCommitment,
      settlementAddress,
      tokenAddress,
    }
  })
}

export async function finalizeLocalPrivatePayment(input: { chainInvoiceId: number }): Promise<LocalFinalizedPayment> {
  return runExclusiveLocalFhevm(async () => {
    if (!Number.isSafeInteger(input.chainInvoiceId) || input.chainInvoiceId < 0) {
      throw new Error('chainInvoiceId must be a non-negative safe integer.')
    }

    const settlementAddress = localDevAddresses.contracts.PrivateCheckoutSettlement
    if (!settlementAddress) {
      throw new Error('local-dev private checkout settlement is not deployed.')
    }

    const { hre } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const operator = signers[0] as LocalSigner | undefined
    if (!operator) {
      throw new Error('No local Hardhat signer is available to finalize the private checkout.')
    }

    const operatorAddress = getAddress(await operator.getAddress()) as Hex
    const settlement = (await hre.ethers.getContractAt(
      'PrivateCheckoutSettlement',
      settlementAddress,
      operator,
    )) as LocalPrivateCheckoutSettlement
    const orderCommitment = toHex(await settlement.orderCommitmentOf(BigInt(input.chainInvoiceId)), 'order commitment')
    const status = chainValueToBigInt(await settlement.statusOf(orderCommitment))

    if (status === checkoutStatus.created) {
      throw new Error('Private payment has not been submitted yet.')
    }
    if (status === checkoutStatus.accepted) {
      throw new Error('Private payment is already finalized.')
    }
    if (status === checkoutStatus.rejected) {
      throw new Error('Private payment was rejected.')
    }
    if (status === checkoutStatus.expired) {
      throw new Error('Private checkout has expired.')
    }
    if (status !== checkoutStatus.submitted) {
      throw new Error('Private checkout is not ready for finalization.')
    }

    const paymentCheckHandle = toHex(await settlement.paymentCheckHandleOf(orderCommitment), 'payment check handle')
    const proof = await hre.fhevm.publicDecrypt([paymentCheckHandle])
    const accepted = coercePublicBool(proof.clearValues[paymentCheckHandle] ?? proof.clearValues[paymentCheckHandle.toLowerCase()])
    const tx = await settlement.finalizePrivatePayment(
      orderCommitment,
      toHex(proof.abiEncodedClearValues, 'ABI-encoded clear payment result'),
      toHex(proof.decryptionProof, 'decryption proof'),
    )
    const receipt = await tx.wait()
    if (!receipt) {
      throw new Error('Local private checkout finalization transaction was not mined.')
    }

    return {
      accepted,
      chainInvoiceId: input.chainInvoiceId,
      orderCommitment,
      payerAddress: operatorAddress,
      paymentTxHash: toHex(tx.hash, 'finalization transaction hash'),
    }
  })
}

async function encryptLocal64(
  hre: HardhatRuntime,
  input: {
    amountMinorUnits: bigint
    contractAddress: Hex
    userAddress: Hex
  },
): Promise<LocalEncryptedInput> {
  if (input.amountMinorUnits < 0n) {
    throw new Error('Encrypted amount must not be negative.')
  }

  const encryptedInput = hre.fhevm.createEncryptedInput(input.contractAddress, input.userAddress)
  encryptedInput.add64(input.amountMinorUnits)
  const encrypted = await encryptedInput.encrypt()
  const handle = encrypted.handles[0]

  if (!handle) {
    throw new Error('Local FHEVM mock returned no encrypted handle.')
  }

  return {
    handle: toHex(handle, 'encrypted handle'),
    inputProof: toHex(encrypted.inputProof, 'encrypted input proof'),
  }
}

function localCommitment(...parts: string[]): Hex {
  return keccak256(toBytes(`mermer-pay:local-dev:${parts.join(':')}`))
}

async function localHardhatRuntime(): Promise<{ hre: HardhatRuntime }> {
  if (!hardhatPromise) {
    hardhatPromise = loadLocalHardhatRuntime()
  }

  return hardhatPromise
}

async function runExclusiveLocalFhevm<T>(operation: () => Promise<T>): Promise<T> {
  const previous = localOperationQueue
  let release: () => void = () => {}

  localOperationQueue = new Promise((resolve) => {
    release = resolve
  })
  await previous.catch(() => undefined)

  try {
    return await operation()
  } finally {
    release()
  }
}

async function loadLocalHardhatRuntime(): Promise<{ hre: HardhatRuntime }> {
  const hardhatConfigPath = findHardhatConfig(process.cwd())
  process.env.HARDHAT_NETWORK ??= 'localhost'
  process.env.HARDHAT_CONFIG ??= hardhatConfigPath

  const require = createRequire(import.meta.url)
  const hre = require('hardhat') as HardhatRuntime
  await hre.fhevm.initializeCLIApi()

  return { hre }
}

function findHardhatConfig(start: string): string {
  let current = start

  for (;;) {
    const candidate = join(current, 'contracts', 'hardhat.config.js')
    if (existsSync(candidate)) {
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      throw new Error('Unable to locate contracts/hardhat.config.js for local FHEVM dev mode.')
    }

    current = parent
  }
}

function toHex(value: unknown, label: string): Hex {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)) {
    return value as Hex
  }

  if (value instanceof Uint8Array) {
    return bytesToHex(value)
  }

  throw new Error(`Local FHEVM mock returned an invalid ${label}.`)
}

function chainValueToBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number') {
    return BigInt(value)
  }
  if (typeof value === 'string') {
    return BigInt(value)
  }
  if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return BigInt(value.toString())
  }

  throw new Error('Local chain returned a value that cannot be converted to bigint.')
}

function coercePublicBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value === 1n
  }
  if (typeof value === 'number') {
    return value === 1
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1' || value === '0x1'
  }

  return false
}
