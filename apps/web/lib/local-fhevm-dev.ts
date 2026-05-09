import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToHex, getAddress, isAddress, keccak256, toBytes, type Hex } from 'viem'
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
    publicDecrypt(handles: Hex[]): Promise<{
      abiEncodedClearValues: Hex
      clearValues: Record<string, boolean | bigint | number | string | undefined>
      decryptionProof: Hex
    }>
    debugger: {
      decryptEuint(type: unknown, handle: Hex): Promise<bigint | number | string>
    }
  }
}

type MockUtils = {
  FhevmType: {
    euint64: unknown
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

type LocalConfidentialToken = {
  balanceOf(address: string): Promise<unknown>
  connect(signer: unknown): {
    approve(spender: string, encryptedAmount: Hex, inputProof: Hex): Promise<LocalTx>
    mint(address: string, amount: bigint): Promise<LocalTx>
  }
}

type LocalSubscriptionRegistry = {
  connect(signer: unknown): LocalSubscriptionRegistry
  ensureMerchantPass(merchant: string): Promise<LocalTx>
  finalizeSubscriptionChange(passId: bigint, abiEncodedAccepted: Hex, decryptionProof: Hex): Promise<LocalTx>
  passOfMerchant(merchant: string): Promise<unknown>
  requestSubscriptionChange(
    passId: bigint,
    encryptedPlanCode: Hex,
    encryptedPaidAmount: Hex,
    inputProof: Hex,
  ): Promise<LocalTx>
  subscriptionCheckHandleOf(passId: bigint): Promise<unknown>
  termsVersionOf(passId: bigint): Promise<unknown>
}

type LocalMockPaymentRail = {
  balanceHandleOf(accountCommitment: Hex): Promise<unknown>
  connect(signer: unknown): {
    fund(accountCommitment: Hex, encryptedAmount: Hex, inputProof: Hex): Promise<LocalTx>
  }
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
  submitPrivatePayment(
    orderCommitment: Hex,
    accountCommitment: Hex,
    paymentNonce: Hex,
    encryptedPaidAmount: Hex,
    inputProof: Hex,
  ): Promise<LocalTx>
}

type LocalEncryptedInput = {
  handle: Hex
  inputProof: Hex
}

type LocalPublicDecryptBool = {
  accepted: boolean
  abiEncodedClearValues: Hex
  decryptionProof: Hex
}

export type LocalConfidentialWalletSnapshot = {
  address: Hex
  accountCommitment: Hex
  balanceHandle: Hex
  balanceLabel: string
  balanceMinorUnits: string
  mintedMinorUnits: string
  mintTxHash: Hex | null
  paymentRailAddress?: Hex
  tokenAddress: Hex
}

export type LocalChainInvoice = {
  chainInvoiceId: number
  chainTxHash: Hex
  expiresAt: number
  orderCommitment?: Hex
  paymentRailAddress?: Hex
  settlementBucketCommitment?: Hex
  settlementAddress: Hex
}

export type LocalPrivateCheckoutPayment = {
  accepted: boolean
  chainInvoiceId: number
  finalizeTxHash: Hex
  orderCommitment: Hex
  paymentCheckHandle: Hex
  paymentTxHash: Hex
}

const defaultBalanceTarget = 1_000_000_000n
const zeroHandle = `0x${'0'.repeat(64)}` as Hex

let hardhatPromise: Promise<{ hre: HardhatRuntime; mockUtils: MockUtils }> | null = null
let localOperationQueue: Promise<void> = Promise.resolve()

export async function readLocalConfidentialWallet(input: {
  address: string
  ensureTargetMinorUnits?: bigint
}): Promise<LocalConfidentialWalletSnapshot> {
  return runExclusiveLocalFhevm(async () => {
    if (!isAddress(input.address)) {
      throw new Error('address must be a valid EVM address.')
    }

    const paymentRailAddress = localDevAddresses.contracts.MockConfidentialPaymentRail
    if (!paymentRailAddress) {
      throw new Error('MockConfidentialPaymentRail is missing from the local-dev manifest.')
    }

    const address = getAddress(input.address) as Hex
    const accountCommitment = accountCommitmentForAddress(address)
    const { hre, mockUtils } = await localHardhatRuntime()
    const rail = (await hre.ethers.getContractAt(
      'MockConfidentialPaymentRail',
      paymentRailAddress,
    )) as LocalMockPaymentRail
    let balanceHandle = toHex(await rail.balanceHandleOf(accountCommitment), 'balance handle')
    let balance = await decryptLocalEuint64(balanceHandle, hre, mockUtils)
    let mintedMinorUnits = 0n
    let mintTxHash: Hex | null = null

    if (input.ensureTargetMinorUnits && balance < input.ensureTargetMinorUnits) {
      const signers = await hre.ethers.getSigners()
      const owner = signers[0]
      if (!owner) {
        throw new Error('No local Hardhat signer is available to fund the confidential wallet.')
      }

      mintedMinorUnits = input.ensureTargetMinorUnits - balance
      const ownerAddress = getAddress(await (owner as LocalSigner).getAddress()) as Hex
      const encrypted = await encryptLocal64(hre, {
        amountMinorUnits: mintedMinorUnits,
        contractAddress: paymentRailAddress,
        userAddress: ownerAddress,
      })
      const tx = await rail.connect(owner).fund(accountCommitment, encrypted.handle, encrypted.inputProof)
      mintTxHash = tx.hash
      await tx.wait()
      balanceHandle = toHex(await rail.balanceHandleOf(accountCommitment), 'balance handle')
      balance = await decryptLocalEuint64(balanceHandle, hre, mockUtils)
    }

    return {
      address,
      accountCommitment,
      balanceHandle,
      balanceLabel: formatMinorUnits(balance),
      balanceMinorUnits: balance.toString(),
      mintedMinorUnits: mintedMinorUnits.toString(),
      mintTxHash,
      paymentRailAddress,
      tokenAddress: paymentRailAddress,
    }
  })
}

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
    const paymentRailAddress = localDevAddresses.contracts.MockConfidentialPaymentRail
    if (!settlementAddress || !paymentRailAddress) {
      throw new Error('local-dev private checkout contracts are not deployed.')
    }

    const { hre } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const relayer = signers[0] as LocalSigner | undefined
    if (!relayer) {
      throw new Error('No local Hardhat signer is available to create the private checkout.')
    }

    const relayerAddress = getAddress(await relayer.getAddress()) as Hex
    const settlement = (await hre.ethers.getContractAt(
      'PrivateCheckoutSettlement',
      settlementAddress,
      relayer,
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
      userAddress: relayerAddress,
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
      paymentRailAddress,
      settlementBucketCommitment,
      settlementAddress,
    }
  })
}

export async function submitLocalPrivateCheckoutPayment(input: {
  amountMinorUnits: bigint
  chainInvoiceId: number
  payerAddress: string
  paymentNonce: Hex
}): Promise<LocalPrivateCheckoutPayment> {
  return runExclusiveLocalFhevm(async () => {
    if (input.amountMinorUnits <= 0n) {
      throw new Error('Private checkout payment amount must be greater than zero.')
    }
    if (!Number.isSafeInteger(input.chainInvoiceId) || input.chainInvoiceId < 0) {
      throw new Error('chainInvoiceId must be a non-negative safe integer.')
    }
    if (!isAddress(input.payerAddress)) {
      throw new Error('payerAddress must be a valid EVM address.')
    }

    const settlementAddress = localDevAddresses.contracts.PrivateCheckoutSettlement
    const paymentRailAddress = localDevAddresses.contracts.MockConfidentialPaymentRail
    if (!settlementAddress || !paymentRailAddress) {
      throw new Error('local-dev private checkout contracts are not deployed.')
    }

    const payerAddress = getAddress(input.payerAddress) as Hex
    const accountCommitment = accountCommitmentForAddress(payerAddress)
    const { hre, mockUtils } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const relayer = signers[0] as LocalSigner | undefined
    if (!relayer) {
      throw new Error('No local Hardhat signer is available to submit the private checkout.')
    }
    const relayerAddress = getAddress(await relayer.getAddress()) as Hex
    const settlement = (await hre.ethers.getContractAt(
      'PrivateCheckoutSettlement',
      settlementAddress,
      relayer,
    )) as LocalPrivateCheckoutSettlement
    const rail = (await hre.ethers.getContractAt(
      'MockConfidentialPaymentRail',
      paymentRailAddress,
    )) as LocalMockPaymentRail
    const balanceHandle = toHex(await rail.balanceHandleOf(accountCommitment), 'balance handle')
    const balance = await decryptLocalEuint64(balanceHandle, hre, mockUtils)

    if (balance < input.amountMinorUnits) {
      throw new Error('Local confidential cUSDT balance is too low. Deposit from the CardForge wallet panel first.')
    }

    const orderCommitment = toHex(
      await settlement.orderCommitmentOf(BigInt(input.chainInvoiceId)),
      'order commitment',
    )
    const encryptedPayment = await encryptLocal64(hre, {
      amountMinorUnits: input.amountMinorUnits,
      contractAddress: settlementAddress,
      userAddress: relayerAddress,
    })
    const paymentTx = await settlement.submitPrivatePayment(
      orderCommitment,
      accountCommitment,
      input.paymentNonce,
      encryptedPayment.handle,
      encryptedPayment.inputProof,
    )
    await paymentTx.wait()

    const paymentCheckHandle = toHex(await settlement.paymentCheckHandleOf(orderCommitment), 'payment check handle')
    const proof = await publicDecryptLocalBoolWithRuntime(hre, paymentCheckHandle)
    const finalizeTx = await settlement.finalizePrivatePayment(
      orderCommitment,
      proof.abiEncodedClearValues,
      proof.decryptionProof,
    )
    await finalizeTx.wait()

    return {
      accepted: proof.accepted,
      chainInvoiceId: input.chainInvoiceId,
      finalizeTxHash: toHex(finalizeTx.hash, 'private checkout finalize tx hash'),
      orderCommitment,
      paymentCheckHandle,
      paymentTxHash: toHex(paymentTx.hash, 'private checkout payment tx hash'),
    }
  })
}

export async function upgradeLocalGrowthSubscription(input: {
  billingCycle: 'annual' | 'monthly'
  ownerAddress: string
}): Promise<{
  entitlementTxHash: Hex
  entitlementVersion: number
  passId: string
  subscriptionCheckHandle: Hex
}> {
  return runExclusiveLocalFhevm(async () => {
    if (!isAddress(input.ownerAddress)) {
      throw new Error('ownerAddress must be a valid EVM address.')
    }

    const tokenAddress = localDevAddresses.contracts.ConfidentialUSDMock
    const subscriptionRegistryAddress = localDevAddresses.contracts.PrivateSubscriptionRegistry
    if (!tokenAddress || !subscriptionRegistryAddress) {
      throw new Error('local-dev subscription contracts are not deployed.')
    }

    const ownerAddress = getAddress(input.ownerAddress) as Hex
    const { hre, mockUtils } = await localHardhatRuntime()
    const signer = await findLocalSigner(hre, ownerAddress)
    const token = (await hre.ethers.getContractAt('ConfidentialUSDMock', tokenAddress, signer)) as LocalConfidentialToken
    const registry = (await hre.ethers.getContractAt(
      'PrivateSubscriptionRegistry',
      subscriptionRegistryAddress,
      signer,
    )) as LocalSubscriptionRegistry
    const priceMinorUnits = input.billingCycle === 'annual' ? 990_000000n : 99_000000n

    await (await registry.ensureMerchantPass(ownerAddress)).wait()
    const passId = chainValueToBigInt(await registry.passOfMerchant(ownerAddress))

    let tokenBalanceHandle = toHex(await token.balanceOf(ownerAddress), 'subscription token balance handle')
    let tokenBalance = await decryptLocalEuint64(tokenBalanceHandle, hre, mockUtils)
    if (tokenBalance < priceMinorUnits) {
      const signers = await hre.ethers.getSigners()
      const owner = signers[0]
      if (!owner) {
        throw new Error('No local Hardhat signer is available to fund the subscription token.')
      }
      await (await token.connect(owner).mint(ownerAddress, priceMinorUnits - tokenBalance)).wait()
      tokenBalanceHandle = toHex(await token.balanceOf(ownerAddress), 'subscription token balance handle')
      tokenBalance = await decryptLocalEuint64(tokenBalanceHandle, hre, mockUtils)
    }
    if (tokenBalance < priceMinorUnits) {
      throw new Error('Local subscription cUSDT balance is too low.')
    }

    const approval = await encryptLocal64(hre, {
      amountMinorUnits: priceMinorUnits,
      contractAddress: tokenAddress,
      userAddress: ownerAddress,
    })
    await (await token.connect(signer).approve(subscriptionRegistryAddress, approval.handle, approval.inputProof)).wait()

    const encryptedUpgrade = await encryptLocalSubscriptionChange(hre, {
      contractAddress: subscriptionRegistryAddress,
      paidAmount: priceMinorUnits,
      planCode: 2n,
      userAddress: ownerAddress,
    })
    await (
      await registry.requestSubscriptionChange(
        passId,
        encryptedUpgrade.planCodeHandle,
        encryptedUpgrade.paidAmountHandle,
        encryptedUpgrade.inputProof,
      )
    ).wait()

    const subscriptionCheckHandle = toHex(
      await registry.subscriptionCheckHandleOf(passId),
      'subscription check handle',
    )
    const proof = await publicDecryptLocalBoolWithRuntime(hre, subscriptionCheckHandle)
    if (!proof.accepted) {
      throw new Error('Local Growth subscription proof was rejected.')
    }

    const finalizeTx = await registry.finalizeSubscriptionChange(
      passId,
      proof.abiEncodedClearValues,
      proof.decryptionProof,
    )
    await finalizeTx.wait()
    const entitlementVersion = Number(chainValueToBigInt(await registry.termsVersionOf(passId)))

    return {
      entitlementTxHash: toHex(finalizeTx.hash, 'subscription finalization tx hash'),
      entitlementVersion,
      passId: passId.toString(),
      subscriptionCheckHandle,
    }
  })
}

async function decryptLocalEuint64(handle: Hex, hre: HardhatRuntime, mockUtils: MockUtils): Promise<bigint> {
  if (handle === zeroHandle) {
    return 0n
  }

  const decrypted = await hre.fhevm.debugger.decryptEuint(mockUtils.FhevmType.euint64, handle)
  return BigInt(decrypted.toString())
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

async function encryptLocalSubscriptionChange(
  hre: HardhatRuntime,
  input: {
    contractAddress: Hex
    paidAmount: bigint
    planCode: bigint
    userAddress: Hex
  },
): Promise<{ inputProof: Hex; paidAmountHandle: Hex; planCodeHandle: Hex }> {
  const encryptedInput = hre.fhevm.createEncryptedInput(input.contractAddress, input.userAddress)
  encryptedInput.add16(input.planCode)
  encryptedInput.add64(input.paidAmount)
  const encrypted = await encryptedInput.encrypt()
  const planCodeHandle = encrypted.handles[0]
  const paidAmountHandle = encrypted.handles[1]

  if (!planCodeHandle || !paidAmountHandle) {
    throw new Error('Local FHEVM mock returned incomplete subscription handles.')
  }

  return {
    inputProof: toHex(encrypted.inputProof, 'subscription input proof'),
    paidAmountHandle: toHex(paidAmountHandle, 'encrypted subscription amount handle'),
    planCodeHandle: toHex(planCodeHandle, 'encrypted subscription plan handle'),
  }
}

async function publicDecryptLocalBoolWithRuntime(
  hre: HardhatRuntime,
  handle: Hex,
): Promise<LocalPublicDecryptBool> {
  const result = await hre.fhevm.publicDecrypt([handle])
  const accepted = result.clearValues[handle] ?? result.clearValues[handle.toLowerCase()]

  if (typeof accepted !== 'boolean') {
    throw new Error('Local FHEVM mock returned a non-boolean payment check result.')
  }

  return {
    accepted,
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  }
}

async function findLocalSigner(hre: HardhatRuntime, address: Hex): Promise<unknown> {
  const signers = await hre.ethers.getSigners()

  for (const signer of signers) {
    const signerAddress = getAddress(await (signer as LocalSigner).getAddress())
    if (signerAddress === address) {
      return signer
    }
  }

  throw new Error('The selected local-dev wallet is not one of the Hardhat signers.')
}

function accountCommitmentForAddress(address: Hex): Hex {
  const secret =
    process.env.MERMER_ACCOUNT_COMMITMENT_SECRET ??
    process.env.MERMER_OPERATOR_KEY ??
    'local-dev-account-commitment'
  return localCommitment('account', secret, getAddress(address))
}

function localCommitment(...parts: string[]): Hex {
  return keccak256(toBytes(`mermer-pay:local-dev:${parts.join(':')}`))
}

async function localHardhatRuntime(): Promise<{ hre: HardhatRuntime; mockUtils: MockUtils }> {
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

async function loadLocalHardhatRuntime(): Promise<{ hre: HardhatRuntime; mockUtils: MockUtils }> {
  const hardhatConfigPath = findHardhatConfig(process.cwd())
  process.env.HARDHAT_NETWORK ??= 'localhost'
  process.env.HARDHAT_CONFIG ??= hardhatConfigPath

  const require = createRequire(import.meta.url)
  const hre = require('hardhat') as HardhatRuntime
  const mockUtils = require('@fhevm/mock-utils') as MockUtils
  await hre.fhevm.initializeCLIApi()

  return { hre, mockUtils }
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

function formatMinorUnits(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = value % 1_000_000n
  const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '')

  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ''} cUSDT`
}
