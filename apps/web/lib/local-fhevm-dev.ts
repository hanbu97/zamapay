import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToHex, getAddress, isAddress, type Hex } from 'viem'
import { localDevAddresses } from './contracts.ts'

type HardhatRuntime = {
  ethers: {
    getContractAt(name: string, address: string, signer?: unknown): Promise<unknown>
    getSigners(): Promise<unknown[]>
  }
  fhevm: {
    initializeCLIApi(): Promise<void>
    createEncryptedInput(contractAddress: string, userAddress: string): {
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

type LocalParsedLog = {
  args?: {
    invoiceId?: unknown
  }
  name?: string
}

type LocalConfidentialToken = {
  balanceOf(address: string): Promise<unknown>
  connect(signer: unknown): {
    mint(address: string, amount: bigint): Promise<LocalTx>
  }
}

type LocalMerchantRegistry = {
  isMerchant(address: string): Promise<boolean>
  registerMerchant(payoutWallet: string, label: string): Promise<LocalTx>
}

type LocalInvoiceSettlement = {
  createInvoice(externalRef: string, expiresAt: bigint, amountDue: bigint): Promise<LocalTx>
  interface: {
    parseLog(log: unknown): LocalParsedLog | null
  }
}

export type LocalEncryptedInput = {
  handle: Hex
  inputProof: Hex
}

export type LocalPublicDecryptBool = {
  accepted: boolean
  abiEncodedClearValues: Hex
  decryptionProof: Hex
}

export type LocalConfidentialWalletSnapshot = {
  address: Hex
  balanceHandle: Hex
  balanceLabel: string
  balanceMinorUnits: string
  mintedMinorUnits: string
  mintTxHash: Hex | null
  tokenAddress: Hex
}

export type LocalChainInvoice = {
  chainInvoiceId: number
  chainTxHash: Hex
  expiresAt: number
  settlementAddress: Hex
}

const defaultBalanceTarget = 1_000_000_000n
const zeroHandle = `0x${'0'.repeat(64)}` as Hex

let hardhatPromise: Promise<{ hre: HardhatRuntime; mockUtils: MockUtils }> | null = null
let localOperationQueue: Promise<void> = Promise.resolve()

export async function createLocalEncrypted64(input: {
  amountMinorUnits: bigint
  contractAddress: Hex
  userAddress: Hex
}): Promise<LocalEncryptedInput> {
  return runExclusiveLocalFhevm(async () => {
    if (input.amountMinorUnits <= 0n) {
      throw new Error('Encrypted amount must be greater than zero.')
    }

    const { hre } = await localHardhatRuntime()
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
  })
}

export async function publicDecryptLocalBool(handle: Hex): Promise<LocalPublicDecryptBool> {
  return runExclusiveLocalFhevm(async () => {
    const { hre } = await localHardhatRuntime()
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
  })
}

export async function readLocalConfidentialWallet(input: {
  address: string
  ensureTargetMinorUnits?: bigint
}): Promise<LocalConfidentialWalletSnapshot> {
  return runExclusiveLocalFhevm(async () => {
    if (!isAddress(input.address)) {
      throw new Error('address must be a valid EVM address.')
    }

    const tokenAddress = localDevAddresses.contracts.ConfidentialUSDMock
    if (!tokenAddress) {
      throw new Error('ConfidentialUSDMock is missing from the local-dev manifest.')
    }

    const address = getAddress(input.address) as Hex
    const { hre, mockUtils } = await localHardhatRuntime()
    const token = (await hre.ethers.getContractAt('ConfidentialUSDMock', tokenAddress)) as LocalConfidentialToken
    let balanceHandle = toHex(await token.balanceOf(address), 'balance handle')
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
      const tx = await token.connect(owner).mint(address, mintedMinorUnits)
      mintTxHash = tx.hash
      await tx.wait()
      balanceHandle = toHex(await token.balanceOf(address), 'balance handle')
      balance = await decryptLocalEuint64(balanceHandle, hre, mockUtils)
    }

    return {
      address,
      balanceHandle,
      balanceLabel: formatMinorUnits(balance),
      balanceMinorUnits: balance.toString(),
      mintedMinorUnits: mintedMinorUnits.toString(),
      mintTxHash,
      tokenAddress,
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

    const registryAddress = localDevAddresses.contracts.MerchantRegistry
    const settlementAddress = localDevAddresses.contracts.ConfidentialInvoiceSettlement
    if (!registryAddress || !settlementAddress) {
      throw new Error('local-dev settlement contracts are not deployed.')
    }

    const { hre } = await localHardhatRuntime()
    const signers = await hre.ethers.getSigners()
    const merchant = signers[0] as LocalSigner | undefined
    if (!merchant) {
      throw new Error('No local Hardhat signer is available to create the chain invoice.')
    }

    const merchantAddress = getAddress(await merchant.getAddress()) as Hex
    const registry = (await hre.ethers.getContractAt('MerchantRegistry', registryAddress, merchant)) as LocalMerchantRegistry
    if (!(await registry.isMerchant(merchantAddress))) {
      await (await registry.registerMerchant(merchantAddress, 'CardForge local merchant')).wait()
    }

    const settlement = (await hre.ethers.getContractAt(
      'ConfidentialInvoiceSettlement',
      settlementAddress,
      merchant,
    )) as LocalInvoiceSettlement
    const expiresInSeconds = input.expiresInSeconds ?? 3600
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    const tx = await settlement.createInvoice(externalRef, BigInt(expiresAt), input.amountMinorUnits)
    const receipt = await tx.wait()
    if (!receipt) {
      throw new Error('Local chain invoice transaction was not mined.')
    }

    return {
      chainInvoiceId: invoiceCreatedId(settlement, receipt),
      chainTxHash: toHex(tx.hash, 'invoice transaction hash'),
      expiresAt,
      settlementAddress,
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

function invoiceCreatedId(settlement: LocalInvoiceSettlement, receipt: LocalTxReceipt): number {
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log)
      if (parsed?.name !== 'InvoiceCreated') {
        continue
      }

      const invoiceId = parsed.args?.invoiceId
      if (invoiceId === undefined || invoiceId === null) {
        throw new Error('InvoiceCreated event does not include invoiceId.')
      }

      const numericInvoiceId = Number(BigInt(invoiceId.toString()))
      if (!Number.isSafeInteger(numericInvoiceId)) {
        throw new Error('InvoiceCreated invoiceId is outside the safe integer range.')
      }

      return numericInvoiceId
    } catch (caught) {
      if (caught instanceof Error && caught.message.startsWith('InvoiceCreated')) {
        throw caught
      }
    }
  }

  throw new Error('InvoiceCreated event not found in local chain invoice transaction.')
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

function formatMinorUnits(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = value % 1_000_000n
  const fractionText = fraction.toString().padStart(6, '0').replace(/0+$/, '')

  return `${whole.toLocaleString()}${fractionText ? `.${fractionText}` : ''} cUSDT`
}
