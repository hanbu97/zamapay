import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToHex, getAddress, isAddress, keccak256, toBytes, type Hex } from 'viem'
import { localDevAddresses } from './contracts.ts'
import { settlementBucketCommitment } from './settlement-bucket'

type HardhatRuntime = {
  ethers: {
    getContractAt(name: string, address: string, signer?: unknown): Promise<unknown>
    getSigners(): Promise<unknown[]>
    provider: {
      getTransactionReceipt(hash: string): Promise<unknown | null>
    }
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
    bucketOwnerCommitment: Hex,
    encryptedExpectedAmount: Hex,
    encryptedMerchantNetAmount: Hex,
    encryptedPlatformFeeAmount: Hex,
    inputProof: Hex,
    expiresAt: bigint,
  ): Promise<LocalTx>
  finalizePrivatePayment(orderCommitment: Hex, abiEncodedPaymentAccepted: Hex, decryptionProof: Hex): Promise<LocalTx>
  requestPrivateWithdraw(
    settlementBucketCommitment: Hex,
    withdrawalNonce: Hex,
    bucketOwner: Hex,
    recipient: Hex,
    encryptedAmount: Hex,
    inputProof: Hex,
    deadline: bigint,
    authorization: Hex,
  ): Promise<LocalTx>
  orderCommitmentOf(checkoutId: bigint): Promise<unknown>
  paymentCheckHandleOf(orderCommitment: Hex): Promise<unknown>
  statusOf(orderCommitment: Hex): Promise<unknown>
  withdrawalCheckHandleOf(withdrawalNonce: Hex): Promise<unknown>
}

type LocalPrivateSubscriptionRegistry = {
  finalizeSubscriptionChange(passId: bigint, abiEncodedAccepted: Hex, decryptionProof: Hex): Promise<LocalTx>
  passOfMerchant(merchant: Hex): Promise<unknown>
  subscriptionCheckHandleOf(passId: bigint): Promise<unknown>
  termsVersionOf(passId: bigint): Promise<unknown>
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

export type LocalFinalizedSubscription = {
  accepted: boolean
  finalizationTxHash: Hex
  passId: string
  subscriptionCheckHandle: Hex
  termsVersion: number
}

export type LocalSubmittedWithdraw = {
  chainTxHash: Hex
  withdrawCheckHandle: Hex
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
  merchantNetMinorUnits: bigint
  merchantOwnerAddress: string
  platformFeeMinorUnits: bigint
  settlementBucketSeed: string
}): Promise<LocalChainInvoice> {
  return runExclusiveLocalFhevm(async () => {
    if (input.amountMinorUnits <= 0n) {
      throw new Error('Local chain invoice amount must be greater than zero.')
    }

    const externalRef = input.externalRef.trim()
    if (!externalRef) {
      throw new Error('Local chain invoice externalRef is required.')
    }
    const bucketSeed = input.settlementBucketSeed.trim()
    if (!bucketSeed) {
      throw new Error('Local chain invoice settlementBucketSeed is required.')
    }
    if (!isAddress(input.merchantOwnerAddress)) {
      throw new Error('Local chain invoice merchantOwnerAddress must be a valid EVM address.')
    }
    if (input.merchantNetMinorUnits <= 0n || input.platformFeeMinorUnits < 0n) {
      throw new Error('Local chain invoice billing split is invalid.')
    }
    if (input.merchantNetMinorUnits + input.platformFeeMinorUnits !== input.amountMinorUnits) {
      throw new Error('Local chain invoice billing split must equal the gross amount.')
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
    const bucketCommitment = settlementBucketCommitment(bucketSeed)
    const encryptedAmounts = await encryptLocalCheckoutAmounts(hre, {
      amountMinorUnits: input.amountMinorUnits,
      contractAddress: settlementAddress,
      merchantNetMinorUnits: input.merchantNetMinorUnits,
      platformFeeMinorUnits: input.platformFeeMinorUnits,
      userAddress: creatorAddress,
    })
    const tx = await settlement.createPrivateCheckout(
      orderCommitment,
      bucketCommitment,
      ownerAddressCommitment(bucketCommitment, input.merchantOwnerAddress),
      encryptedAmounts.expectedAmountHandle,
      encryptedAmounts.merchantNetAmountHandle,
      encryptedAmounts.platformFeeAmountHandle,
      encryptedAmounts.inputProof,
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
      settlementBucketCommitment: bucketCommitment,
      settlementAddress,
      tokenAddress,
    }
  })
}

async function encryptLocalCheckoutAmounts(
  hre: HardhatRuntime,
  input: {
    amountMinorUnits: bigint
    contractAddress: Hex
    merchantNetMinorUnits: bigint
    platformFeeMinorUnits: bigint
    userAddress: Hex
  },
): Promise<{
  expectedAmountHandle: Hex
  inputProof: Hex
  merchantNetAmountHandle: Hex
  platformFeeAmountHandle: Hex
}> {
  const encryptedInput = hre.fhevm.createEncryptedInput(input.contractAddress, input.userAddress)
  encryptedInput.add64(input.amountMinorUnits)
  encryptedInput.add64(input.merchantNetMinorUnits)
  encryptedInput.add64(input.platformFeeMinorUnits)
  const encrypted = await encryptedInput.encrypt()
  const expectedAmountHandle = toHex(encrypted.handles[0], 'encrypted expected amount handle')
  const merchantNetAmountHandle = toHex(encrypted.handles[1], 'encrypted merchant net amount handle')
  const platformFeeAmountHandle = toHex(encrypted.handles[2], 'encrypted platform fee amount handle')

  return {
    expectedAmountHandle,
    inputProof: toHex(encrypted.inputProof, 'encrypted amount input proof'),
    merchantNetAmountHandle,
    platformFeeAmountHandle,
  }
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

export async function submitLocalPrivateWithdraw(input: {
  authorization: Hex
  bucketOwner: Hex
  deadline: number
  encryptedAmount: Hex
  inputProof: Hex
  recipient: Hex
  settlementBucketCommitment: Hex
  withdrawalNonce: Hex
}): Promise<LocalSubmittedWithdraw> {
  return runExclusiveLocalFhevm(async () => {
    const settlementAddress = localDevAddresses.contracts.PrivateCheckoutSettlement
    if (!settlementAddress) {
      throw new Error('local-dev private checkout settlement is not deployed.')
    }
    if (!isAddress(input.bucketOwner) || !isAddress(input.recipient)) {
      throw new Error('Local private withdraw requires valid bucket owner and recipient addresses.')
    }
    if (!Number.isSafeInteger(input.deadline) || input.deadline <= 0) {
      throw new Error('Local private withdraw deadline must be a positive safe integer.')
    }

    const { hre } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const chainSubmitter = signers[0] as LocalSigner | undefined
    if (!chainSubmitter) {
      throw new Error('No local Hardhat signer is available to submit the private withdraw.')
    }

    const settlement = (await hre.ethers.getContractAt(
      'PrivateCheckoutSettlement',
      settlementAddress,
      chainSubmitter,
    )) as LocalPrivateCheckoutSettlement
    const tx = await settlement.requestPrivateWithdraw(
      input.settlementBucketCommitment,
      input.withdrawalNonce,
      getAddress(input.bucketOwner) as Hex,
      getAddress(input.recipient) as Hex,
      input.encryptedAmount,
      input.inputProof,
      BigInt(input.deadline),
      input.authorization,
    )
    const receipt = await tx.wait()
    if (!receipt) {
      throw new Error('Local private withdraw transaction was not mined.')
    }
    const withdrawCheckHandle = toHex(
      await settlement.withdrawalCheckHandleOf(input.withdrawalNonce),
      'withdraw check handle',
    )

    return {
      chainTxHash: toHex(tx.hash, 'withdraw transaction hash'),
      withdrawCheckHandle,
    }
  })
}

export async function finalizeLocalGrowthSubscription(input: {
  ownerAddress: Hex
  subscriptionRequestTxHash: Hex
}): Promise<LocalFinalizedSubscription> {
  return runExclusiveLocalFhevm(async () => {
    const registryAddress = localDevAddresses.contracts.PrivateSubscriptionRegistry
    if (!registryAddress) {
      throw new Error('local-dev private subscription registry is not deployed.')
    }

    const { hre } = await localHardhatRuntime()
    const receipt = await hre.ethers.provider.getTransactionReceipt(input.subscriptionRequestTxHash)
    if (!receipt) {
      throw new Error('Local Growth subscription request transaction was not mined.')
    }

    const signers = await hre.ethers.getSigners()
    const operator = signers[0] as LocalSigner | undefined
    if (!operator) {
      throw new Error('No local Hardhat signer is available to finalize the Growth subscription.')
    }

    const registry = (await hre.ethers.getContractAt(
      'PrivateSubscriptionRegistry',
      registryAddress,
      operator,
    )) as LocalPrivateSubscriptionRegistry
    const merchantAddress = getAddress(input.ownerAddress) as Hex
    const passId = chainValueToBigInt(await registry.passOfMerchant(merchantAddress))
    if (passId === 0n) {
      throw new Error('No merchant subscription pass exists after the local Growth request.')
    }

    const subscriptionCheckHandle = toHex(
      await registry.subscriptionCheckHandleOf(passId),
      'subscription check handle',
    )
    const proof = await hre.fhevm.publicDecrypt([subscriptionCheckHandle])
    const accepted = coercePublicBool(
      proof.clearValues[subscriptionCheckHandle] ?? proof.clearValues[subscriptionCheckHandle.toLowerCase()],
    )
    const tx = await registry.finalizeSubscriptionChange(
      passId,
      toHex(proof.abiEncodedClearValues, 'ABI-encoded clear subscription result'),
      toHex(proof.decryptionProof, 'subscription decryption proof'),
    )
    const finalizedReceipt = await tx.wait()
    if (!finalizedReceipt) {
      throw new Error('Local Growth subscription finalization transaction was not mined.')
    }
    if (!accepted) {
      throw new Error('Encrypted Growth subscription charge was rejected by the contract.')
    }

    const termsVersion = Number(chainValueToBigInt(await registry.termsVersionOf(passId)))
    if (!Number.isSafeInteger(termsVersion) || termsVersion <= 0) {
      throw new Error('Subscription terms version is invalid after finalization.')
    }

    return {
      accepted,
      finalizationTxHash: toHex(tx.hash, 'subscription finalization transaction hash'),
      passId: passId.toString(),
      subscriptionCheckHandle,
      termsVersion,
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

function ownerAddressCommitment(settlementBucketCommitment: Hex, address: string): Hex {
  return keccak256(`${settlementBucketCommitment}${getAddress(address).slice(2)}` as Hex)
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
