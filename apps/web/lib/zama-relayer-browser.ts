import { bytesToHex, decodeAbiParameters, getAddress, isHex, type Hex } from 'viem'
import type { EthereumProvider } from './wallet.ts'

export type ZamaEncryptedEuint64 = {
  handle: Hex
  inputProof: Hex
}

export type ZamaEncryptedSubscriptionChange = {
  inputProof: Hex
  paidAmountHandle: Hex
  planCodeHandle: Hex
}

export type ZamaPublicBoolProof = {
  accepted: boolean
  abiEncodedClearValues: Hex
  decryptionProof: Hex
}

type PublicDecryptRetryState = {
  error: Error
  maxAttempts: number
  nextAttempt: number
}

type RelayerEncryptedInputBuilder = {
  add16(value: bigint): RelayerEncryptedInputBuilder
  add64(value: bigint): RelayerEncryptedInputBuilder
  encrypt(): Promise<{
    handles: Array<Uint8Array | string>
    inputProof: Uint8Array | string
  }>
}

type RelayerInstance = {
  createEncryptedInput(contractAddress: string, userAddress: string): RelayerEncryptedInputBuilder
  publicDecrypt(handles: string[]): Promise<{
    abiEncodedClearValues: Uint8Array | string
    clearValues: Record<string, bigint | boolean | string>
    decryptionProof: Uint8Array | string
  }>
}

const defaultPublicDecryptRetries = 6
const defaultPublicDecryptRetryDelayMs = 2500
const transientPublicDecryptErrors = [
  'not allowed for public decryption',
  'not found',
  'not ready',
  'not yet',
  'not available',
]

type RelayerSdk = {
  SepoliaConfig: Record<string, unknown>
  createInstance(config: Record<string, unknown>): Promise<RelayerInstance>
  initSDK(): Promise<unknown>
}

let sdkPromise: Promise<RelayerSdk> | null = null
let instancePromise: Promise<RelayerInstance> | null = null

function sdk() {
  sdkPromise ??= import('@zama-fhe/relayer-sdk/web') as Promise<RelayerSdk>
  return sdkPromise
}

async function sepoliaInstance(provider: EthereumProvider) {
  if (!instancePromise) {
    instancePromise = sdk().then(async ({ SepoliaConfig, createInstance, initSDK }) => {
      await initSDK()
      return createInstance({
        ...SepoliaConfig,
        network: provider,
      })
    })
  }

  return instancePromise
}

function toHexValue(value: Uint8Array | string, label: string): Hex {
  const hex = typeof value === 'string' ? value : bytesToHex(value)

  if (!isHex(hex)) {
    throw new Error(`${label} is not a hex value.`)
  }

  return hex
}

function publicBoolFromResult(input: {
  abiEncodedClearValues: Hex
  clearValue: bigint | boolean | string | undefined
}): boolean {
  if (typeof input.clearValue === 'boolean') {
    return input.clearValue
  }
  if (typeof input.clearValue === 'bigint') {
    return input.clearValue !== 0n
  }
  if (typeof input.clearValue === 'string') {
    return BigInt(input.clearValue) !== 0n
  }

  const [decoded] = decodeAbiParameters([{ type: 'bool' }], input.abiEncodedClearValues)
  return decoded
}

export async function encryptSepoliaEuint64(input: {
  amountMinorUnits: bigint
  contractAddress: Hex
  provider: EthereumProvider
  userAddress: Hex
}): Promise<ZamaEncryptedEuint64> {
  const instance = await sepoliaInstance(input.provider)
  const builder = instance.createEncryptedInput(getAddress(input.contractAddress), getAddress(input.userAddress))
  const encrypted = await builder.add64(input.amountMinorUnits).encrypt()

  return {
    handle: toHexValue(encrypted.handles[0], 'encrypted euint64 handle'),
    inputProof: toHexValue(encrypted.inputProof, 'encrypted euint64 input proof'),
  }
}

export async function encryptSepoliaSubscriptionChange(input: {
  contractAddress: Hex
  paidAmount: bigint
  planCode: bigint
  provider: EthereumProvider
  userAddress: Hex
}): Promise<ZamaEncryptedSubscriptionChange> {
  const instance = await sepoliaInstance(input.provider)
  const builder = instance.createEncryptedInput(getAddress(input.contractAddress), getAddress(input.userAddress))
  const encrypted = await builder.add16(input.planCode).add64(input.paidAmount).encrypt()

  return {
    planCodeHandle: toHexValue(encrypted.handles[0], 'encrypted plan code handle'),
    paidAmountHandle: toHexValue(encrypted.handles[1], 'encrypted paid amount handle'),
    inputProof: toHexValue(encrypted.inputProof, 'encrypted subscription input proof'),
  }
}

export async function publicDecryptSepoliaBool(input: {
  handle: Hex
  onRetry?: (state: PublicDecryptRetryState) => void
  provider: EthereumProvider
  retries?: number
  retryDelayMs?: number
}): Promise<ZamaPublicBoolProof> {
  const instance = await sepoliaInstance(input.provider)
  const maxAttempts = Math.max(1, Math.floor(input.retries ?? defaultPublicDecryptRetries) + 1)
  const retryDelayMs = input.retryDelayMs ?? defaultPublicDecryptRetryDelayMs
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const proof = await instance.publicDecrypt([input.handle])
      return publicBoolProofFromRelayerResult(input.handle, proof)
    } catch (caught) {
      const error = normalizeError(caught)
      lastError = error
      if (attempt >= maxAttempts || !isTransientPublicDecryptError(error)) {
        throw error
      }

      input.onRetry?.({ error, maxAttempts, nextAttempt: attempt + 1 })
      await sleep(retryDelayMs)
    }
  }

  throw lastError ?? new Error('Public decrypt failed.')
}

function publicBoolProofFromRelayerResult(
  handle: Hex,
  proof: Awaited<ReturnType<RelayerInstance['publicDecrypt']>>,
): ZamaPublicBoolProof {
  const clearValue = proof.clearValues[handle] ?? proof.clearValues[handle.toLowerCase() as Hex]
  const abiEncodedClearValues = toHexValue(proof.abiEncodedClearValues, 'ABI-encoded public decrypt value')

  return {
    accepted: publicBoolFromResult({ abiEncodedClearValues, clearValue }),
    abiEncodedClearValues,
    decryptionProof: toHexValue(proof.decryptionProof, 'public decrypt proof'),
  }
}

function normalizeError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught))
}

function isTransientPublicDecryptError(error: Error): boolean {
  const message = error.message.toLowerCase()
  return transientPublicDecryptErrors.some((marker) => message.includes(marker))
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })
}
