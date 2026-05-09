import { bytesToHex } from 'viem'
import type { EthereumProvider } from './wallet'

type RelayerModule = typeof import('@zama-fhe/relayer-sdk/bundle')
type RelayerInstance = Awaited<ReturnType<RelayerModule['createInstance']>>
type HexString = `0x${string}`

declare global {
  interface Window {
    relayerSDK?: unknown
  }
}

type EncryptPaymentInput = {
  amountMinorUnits: bigint
  contractAddress: HexString
  payerAddress: HexString
  provider: EthereumProvider
}

type EncryptSubscriptionChangeInput = {
  contractAddress: HexString
  merchantAddress: HexString
  paidAmountMinorUnits: bigint
  planCode: number
  provider: EthereumProvider
}

type UserDecryptSettlementInput = {
  contractAddress: HexString
  handle: HexString
  provider: EthereumProvider
  signTypedData: (payload: {
    domain: Record<string, unknown>
    message: Record<string, unknown>
    types: Record<string, unknown>
  }) => Promise<HexString>
  userAddress: HexString
}

type UserDecryptSubscriptionTermsInput = {
  contractAddress: HexString
  feeBpsHandle: HexString
  validUntilHandle: HexString
  provider: EthereumProvider
  signTypedData: (payload: {
    domain: Record<string, unknown>
    message: Record<string, unknown>
    types: Record<string, unknown>
  }) => Promise<HexString>
  userAddress: HexString
}

export type EncryptedPaymentInput = {
  handle: HexString
  inputProof: HexString
}

export type EncryptedSubscriptionChangeInput = {
  paidAmountHandle: HexString
  planCodeHandle: HexString
  inputProof: HexString
}

export type PublicPaymentCheckProof = {
  accepted: boolean
  abiEncodedClearValues: HexString
  decryptionProof: HexString
}

export type DecryptedSubscriptionTerms = {
  feeBps: number
  validUntil: bigint
}

let modulePromise: Promise<RelayerModule> | null = null
let instancePromise: Promise<RelayerInstance> | null = null
let bundleScriptPromise: Promise<void> | null = null

function loadRelayerBundleScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Zama relayer SDK can only be loaded in the browser.'))
  }

  if (window.relayerSDK) {
    return Promise.resolve()
  }

  bundleScriptPromise ??= new Promise((resolve, reject) => {
    const script =
      document.querySelector<HTMLScriptElement>('script[data-mermer-relayer-sdk]') ??
      document.createElement('script')

    script.dataset.mermerRelayerSdk = 'true'
    script.src ||= '/relayer-sdk-js.umd.js'
    script.async = true

    script.addEventListener(
      'load',
      () => {
        if (!window.relayerSDK) {
          reject(new Error('Zama relayer SDK loaded without exposing window.relayerSDK.'))
          return
        }

        resolve()
      },
      { once: true },
    )
    script.addEventListener('error', () => reject(new Error('Failed to load Zama relayer SDK bundle.')), {
      once: true,
    })

    if (!script.parentElement) {
      document.head.appendChild(script)
    }
  })

  return bundleScriptPromise
}

async function loadRelayerModule(): Promise<RelayerModule> {
  await loadRelayerBundleScript()
  modulePromise ??= import('@zama-fhe/relayer-sdk/bundle')
  return modulePromise
}

async function getSepoliaRelayer(provider: EthereumProvider): Promise<RelayerInstance> {
  instancePromise ??= loadRelayerModule().then(async ({ SepoliaConfig, createInstance, initSDK }) => {
    await initSDK()
    return createInstance({ ...SepoliaConfig, network: provider })
  })

  return instancePromise
}

export async function encryptPaymentAmount(input: EncryptPaymentInput): Promise<EncryptedPaymentInput> {
  if (input.amountMinorUnits <= 0n) {
    throw new Error('Payment amount must be greater than zero.')
  }

  const relayer = await getSepoliaRelayer(input.provider)
  const encryptedInput = relayer.createEncryptedInput(input.contractAddress, input.payerAddress)
  const encrypted = await encryptedInput.add64(input.amountMinorUnits).encrypt()
  const handle = encrypted.handles[0]

  if (!handle) {
    throw new Error('Zama relayer returned no encrypted handle.')
  }

  return {
    handle: bytesToHex(handle),
    inputProof: bytesToHex(encrypted.inputProof),
  }
}

export async function encryptSubscriptionChange(
  input: EncryptSubscriptionChangeInput,
): Promise<EncryptedSubscriptionChangeInput> {
  if (input.planCode <= 0) {
    throw new Error('Subscription plan code must be greater than zero.')
  }

  const relayer = await getSepoliaRelayer(input.provider)
  const encryptedInput = relayer.createEncryptedInput(input.contractAddress, input.merchantAddress)
  const encrypted = await encryptedInput.add16(input.planCode).add64(input.paidAmountMinorUnits).encrypt()
  const planCodeHandle = encrypted.handles[0]
  const paidAmountHandle = encrypted.handles[1]

  if (!planCodeHandle || !paidAmountHandle) {
    throw new Error('Zama relayer returned incomplete encrypted subscription handles.')
  }

  return {
    planCodeHandle: bytesToHex(planCodeHandle),
    paidAmountHandle: bytesToHex(paidAmountHandle),
    inputProof: bytesToHex(encrypted.inputProof),
  }
}

export async function publicDecryptPaymentCheck(
  provider: EthereumProvider,
  paymentCheckHandle: HexString,
): Promise<PublicPaymentCheckProof> {
  const relayer = await getSepoliaRelayer(provider)
  const result = await relayer.publicDecrypt([paymentCheckHandle])
  const accepted = result.clearValues[paymentCheckHandle]

  if (typeof accepted !== 'boolean') {
    throw new Error('Zama relayer returned a non-boolean payment check result.')
  }

  return {
    accepted,
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  }
}

export async function userDecryptSettlementAmount(input: UserDecryptSettlementInput): Promise<bigint> {
  const relayer = await getSepoliaRelayer(input.provider)
  const keypair = relayer.generateKeypair()
  const startTimestamp = Math.floor(Date.now() / 1000)
  const durationDays = 1
  const contractAddresses = [input.contractAddress]
  const eip712 = relayer.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays)
  const signature = await input.signTypedData({
    domain: eip712.domain as Record<string, unknown>,
    message: eip712.message as Record<string, unknown>,
    types: {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
  })
  const decrypted = await relayer.userDecrypt(
    [
      {
        contractAddress: input.contractAddress,
        handle: input.handle,
      },
    ],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    contractAddresses,
    input.userAddress,
    startTimestamp,
    durationDays,
  )
  const value = decrypted[input.handle]

  if (value === undefined || typeof value === 'boolean') {
    throw new Error('Zama relayer returned no numeric settlement amount.')
  }

  return BigInt(value.toString())
}

export async function userDecryptSubscriptionTerms(
  input: UserDecryptSubscriptionTermsInput,
): Promise<DecryptedSubscriptionTerms> {
  const relayer = await getSepoliaRelayer(input.provider)
  const keypair = relayer.generateKeypair()
  const startTimestamp = Math.floor(Date.now() / 1000)
  const durationDays = 1
  const contractAddresses = [input.contractAddress]
  const eip712 = relayer.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays)
  const signature = await input.signTypedData({
    domain: eip712.domain as Record<string, unknown>,
    message: eip712.message as Record<string, unknown>,
    types: {
      UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
    },
  })
  const decrypted = await relayer.userDecrypt(
    [
      {
        contractAddress: input.contractAddress,
        handle: input.feeBpsHandle,
      },
      {
        contractAddress: input.contractAddress,
        handle: input.validUntilHandle,
      },
    ],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    contractAddresses,
    input.userAddress,
    startTimestamp,
    durationDays,
  )
  const feeBps = decrypted[input.feeBpsHandle]
  const validUntil = decrypted[input.validUntilHandle]

  if (feeBps === undefined || validUntil === undefined || typeof feeBps === 'boolean' || typeof validUntil === 'boolean') {
    throw new Error('Zama relayer returned incomplete subscription terms.')
  }

  return {
    feeBps: Number(feeBps),
    validUntil: BigInt(validUntil.toString()),
  }
}
