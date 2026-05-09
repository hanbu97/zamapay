import { bytesToHex, concatHex, decodeAbiParameters, keccak256, type Hex } from 'viem'

type RelayerMetadata = {
  ACLAddress: Hex
}

type InputProofResponse = {
  handles: Hex[]
  signatures: Hex[]
}

type PublicDecryptResponse = {
  decrypted_value: Hex
  signatures: Hex[]
}

export type LocalEncrypted64 = {
  handle: Hex
  inputProof: Hex
}

export type LocalEncryptedSubscriptionChange = {
  inputProof: Hex
  paidAmountHandle: Hex
  planCodeHandle: Hex
}

export type LocalPublicBoolProof = {
  accepted: boolean
  abiEncodedClearValues: Hex
  decryptionProof: Hex
}

type LocalEncryptedValue = {
  byteLength: number
  fhevmType: number
  value: bigint
}

const euint16Type = 3
const euint64Type = 5
const extraData = '0x00' as const
const zeroHandle = `0x${'0'.repeat(64)}` as Hex
const zeroTxHash = `0x${'0'.repeat(64)}` as Hex

export async function encryptLocalEuint64(input: {
  amountMinorUnits: bigint
  chainId: number
  contractAddress: Hex
  rpcUrl: string
  userAddress: Hex
}): Promise<LocalEncrypted64> {
  if (input.amountMinorUnits < 0n) {
    throw new Error('Encrypted amount must not be negative.')
  }

  const encrypted = await encryptLocalValues({
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    rpcUrl: input.rpcUrl,
    userAddress: input.userAddress,
    values: [{ byteLength: 8, fhevmType: euint64Type, value: input.amountMinorUnits }],
  })
  const handle = encrypted.handles[0]
  if (!handle) {
    throw new Error('Local FHEVM mock returned no encrypted handle.')
  }

  return {
    handle,
    inputProof: encrypted.inputProof,
  }
}

export async function encryptLocalSubscriptionChange(input: {
  chainId: number
  contractAddress: Hex
  paidAmount: bigint
  planCode: bigint
  rpcUrl: string
  userAddress: Hex
}): Promise<LocalEncryptedSubscriptionChange> {
  if (input.planCode < 0n) {
    throw new Error('Encrypted plan code must not be negative.')
  }
  if (input.paidAmount < 0n) {
    throw new Error('Encrypted subscription amount must not be negative.')
  }

  const encrypted = await encryptLocalValues({
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    rpcUrl: input.rpcUrl,
    userAddress: input.userAddress,
    values: [
      { byteLength: 2, fhevmType: euint16Type, value: input.planCode },
      { byteLength: 8, fhevmType: euint64Type, value: input.paidAmount },
    ],
  })
  const planCodeHandle = encrypted.handles[0]
  const paidAmountHandle = encrypted.handles[1]

  if (!planCodeHandle || !paidAmountHandle) {
    throw new Error('Local FHEVM mock returned incomplete subscription handles.')
  }

  return {
    inputProof: encrypted.inputProof,
    paidAmountHandle,
    planCodeHandle,
  }
}

async function encryptLocalValues(input: {
  chainId: number
  contractAddress: Hex
  rpcUrl: string
  userAddress: Hex
  values: LocalEncryptedValue[]
}): Promise<{ handles: Hex[]; inputProof: Hex }> {
  const metadata = await localFhevmRpc<RelayerMetadata>(input.rpcUrl, 'fhevm_relayer_metadata', [])
  const random32List = input.values.map(() => {
    const random32 = new Uint8Array(32)
    crypto.getRandomValues(random32)
    return random32
  })

  const ciphertextWithInputVerification = mockCiphertext(input.values, random32List)
  const response = await localFhevmRpc<InputProofResponse>(input.rpcUrl, 'fhevm_relayer_v1_input_proof', [
    {
      contractAddress: input.contractAddress,
      userAddress: input.userAddress,
      ciphertextWithInputVerification,
      contractChainId: bigintHex(BigInt(input.chainId)),
      extraData,
      mockData: {
        clearTextValuesBigIntHex: input.values.map((value) => bigintHex(value.value)),
        metadatas: input.values.map((_, index) => ({ blockNumber: 0, index, transactionHash: zeroTxHash })),
        fheTypes: input.values.map((value) => value.fhevmType),
        fhevmTypes: input.values.map((value) => value.fhevmType),
        aclContractAddress: metadata.ACLAddress,
        random32List: random32List.map((random32) => bytesToHex(random32)),
      },
    },
  ])

  return {
    handles: response.handles,
    inputProof: inputProofHex(response.handles, response.signatures),
  }
}

export async function decryptLocalEuint64Handle(rpcUrl: string, handle: Hex): Promise<bigint> {
  if (handle === zeroHandle) {
    return 0n
  }

  const values = await localFhevmRpc<Hex[]>(rpcUrl, 'fhevm_getClearText', [[handle]])
  const value = values[0]
  return value && value !== '0x' ? BigInt(value) : 0n
}

export async function publicDecryptLocalBool(rpcUrl: string, handle: Hex): Promise<LocalPublicBoolProof> {
  const response = await localFhevmRpc<PublicDecryptResponse>(rpcUrl, 'fhevm_relayer_v1_public_decrypt', [
    {
      ciphertextHandles: [handle],
      extraData,
    },
  ])
  const [value] = decodeAbiParameters([{ type: 'uint256' }], response.decrypted_value)

  return {
    accepted: value === 1n,
    abiEncodedClearValues: response.decrypted_value,
    decryptionProof: decryptionProofHex(response.signatures),
  }
}

async function localFhevmRpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl, {
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
    throw new Error(body.error?.message ?? `Local FHEVM RPC ${method} failed with ${response.status}.`)
  }
  if (body.result === undefined) {
    throw new Error(`Local FHEVM RPC ${method} returned no result.`)
  }

  return body.result
}

function mockCiphertext(values: LocalEncryptedValue[], random32List: Uint8Array[]): Hex {
  const chunks = values.flatMap((value, index) => [
    new Uint8Array([value.fhevmType]),
    uintBytes(value.value, value.byteLength),
    random32List[index] ?? new Uint8Array(),
  ])

  return keccak256(concatBytes(...chunks))
}

function inputProofHex(handles: Hex[], signatures: Hex[]): Hex {
  return concatHex([
    `0x${oneByte(handles.length)}${oneByte(signatures.length)}` as Hex,
    ...handles,
    ...signatures,
    extraData,
  ])
}

function decryptionProofHex(signatures: Hex[]): Hex {
  return concatHex([`0x${oneByte(signatures.length)}` as Hex, ...signatures, extraData])
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }

  return output
}

function uintBytes(value: bigint, byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength)
  let cursor = value

  for (let index = byteLength - 1; index >= 0; index -= 1) {
    output[index] = Number(cursor & 0xffn)
    cursor >>= 8n
  }
  if (cursor !== 0n) {
    throw new Error(`Value ${value} does not fit in ${byteLength} bytes.`)
  }

  return output
}

function oneByte(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Expected one byte value, got ${value}.`)
  }

  return value.toString(16).padStart(2, '0')
}

function bigintHex(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex
}
