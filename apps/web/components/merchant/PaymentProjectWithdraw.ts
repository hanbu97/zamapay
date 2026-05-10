import { bytesToHex, createPublicClient, createWalletClient, custom, getAddress, http, keccak256, type Hex } from 'viem'
import { type ProjectEnvironmentKind } from '@/lib/api'
import { contractEnvironmentConfig, type ContractEnvironmentConfig } from '@/lib/contract-environment'
import { privateCheckoutSettlementAbi } from '@/lib/contracts'
import { decryptLocalEuint64Handle, encryptLocalEuint64, publicDecryptLocalBool } from '@/lib/local-fhevm-browser'
import { settlementBucketCommitment } from '@/lib/settlement-bucket'
import { ensureEthereumProvider, ensureWalletChain } from '@/lib/wallet'
import { encryptSepoliaEuint64, publicDecryptSepoliaBool } from '@/lib/zama-relayer-browser'

type WithdrawStatusSetter = (status: string) => void
type BrowserProvider = ReturnType<typeof ensureEthereumProvider>
type BrowserPublicClient = ReturnType<typeof createPublicClient>
type BrowserWalletClient = ReturnType<typeof createWalletClient>
type EncryptedWithdrawAmount = {
  handle: Hex
  inputProof: Hex
}

export type ProjectWithdrawResult = {
  chainTxHash: Hex
  recipientAddress: Hex
  settlementBucketCommitment: Hex
  withdrawalNonce: Hex
  withdrawCheckHandle: Hex
}

export type PendingProjectWithdraw = ProjectWithdrawResult & {
  amountMinorUnits: number
  environment: ProjectEnvironmentKind
  projectId: string
  savedAt: number
}

type SubmittedWithdraw = {
  chainTxHash: Hex
  withdrawCheckHandle: Hex
}

const pendingWithdrawStorageKey = 'zamapay.pendingProjectWithdraws.v1'

export async function runProjectWithdraw(input: {
  amountMinorUnits: number
  environment: ProjectEnvironmentKind
  ownerAddress: string
  projectId: string
  setStatus: WithdrawStatusSetter
}): Promise<ProjectWithdrawResult> {
  const config = contractEnvironmentConfig(input.environment)
  const settlement = ensureHexAddress(
    config.manifest?.contracts.PrivateCheckoutSettlement ?? null,
    'PrivateCheckoutSettlement',
  )
  const rpcUrl = config.walletChain.rpcUrls[0]
  if (!rpcUrl) {
    throw new Error(`${config.label} RPC URL is missing from the wallet chain.`)
  }

  const provider = ensureEthereumProvider()
  input.setStatus(`Switching wallet to ${config.walletChain.name}...`)
  await ensureWalletChain(provider, config.walletChain)

  const walletClient = createWalletClient({ chain: config.chain, transport: custom(provider) })
  const publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) })
  const [selectedAddress] = await walletClient.requestAddresses()
  if (!selectedAddress) {
    throw new Error('No wallet account selected.')
  }

  const signerAddress = getAddress(selectedAddress) as Hex
  const merchantAddress = getAddress(input.ownerAddress)
  if (signerAddress !== merchantAddress) {
    throw new Error(`Switch MetaMask to the merchant wallet ${merchantAddress.slice(0, 6)}...${merchantAddress.slice(-4)} before withdrawing.`)
  }

  const settlementCode = await publicClient.getBytecode({ address: settlement })
  if (!settlementCode || settlementCode === '0x') {
    throw new Error(`PrivateCheckoutSettlement is not deployed at ${settlement}.`)
  }

  const bucketCommitment = settlementBucketCommitment(input.projectId)
  const withdrawalNonce = randomNonce()
  const deadline = Math.floor(Date.now() / 1000) + 600
  const requestedAmount = BigInt(input.amountMinorUnits)

  const submitted =
    config.key === 'local-dev'
      ? await runLocalPrivateWithdraw({
          bucketCommitment,
          config,
          deadline,
          publicClient,
          requestedAmount,
          rpcUrl,
          settlement,
          setStatus: input.setStatus,
          signerAddress,
          walletClient,
          withdrawalNonce,
        })
      : await runSepoliaPrivateWithdraw({
          bucketCommitment,
          config,
          deadline,
          provider,
          publicClient,
          requestedAmount,
          settlement,
          setStatus: input.setStatus,
          signerAddress,
          walletClient,
          withdrawalNonce,
        })

  const evidence = {
    amountMinorUnits: input.amountMinorUnits,
    chainTxHash: submitted.chainTxHash,
    environment: input.environment,
    projectId: input.projectId,
    recipientAddress: signerAddress,
    savedAt: Date.now(),
    settlementBucketCommitment: bucketCommitment,
    withdrawalNonce,
    withdrawCheckHandle: submitted.withdrawCheckHandle,
  } satisfies PendingProjectWithdraw
  if (config.key === 'sepolia') {
    savePendingProjectWithdraw(evidence)
  }

  if (config.key === 'sepolia') {
    input.setStatus('Sepolia withdraw transaction confirmed. Syncing project balance...')
    return evidence
  }

  const withdrawCheck = await publicDecryptLocalBool(rpcUrl, submitted.withdrawCheckHandle)
  if (!withdrawCheck.accepted) {
    throw new Error('The encrypted withdraw check was rejected on chain.')
  }

  return evidence
}

export function clearPendingProjectWithdraw(projectId: string, chainTxHash: Hex) {
  const remaining = pendingProjectWithdraws().filter(
    (withdraw) => withdraw.projectId !== projectId || withdraw.chainTxHash !== chainTxHash,
  )
  writePendingProjectWithdraws(remaining)
}

export function pendingProjectWithdraws(projectId?: string): PendingProjectWithdraw[] {
  const storage = browserStorage()
  if (!storage) {
    return []
  }

  try {
    const parsed = JSON.parse(storage.getItem(pendingWithdrawStorageKey) ?? '[]') as unknown
    const withdraws = Array.isArray(parsed) ? parsed.filter(isPendingProjectWithdraw) : []
    return projectId ? withdraws.filter((withdraw) => withdraw.projectId === projectId) : withdraws
  } catch {
    return []
  }
}

export async function verifiedPendingProjectWithdraws(input: {
  environment: ProjectEnvironmentKind
  projectId: string
  setStatus: WithdrawStatusSetter
}): Promise<PendingProjectWithdraw[]> {
  const pending = pendingProjectWithdraws(input.projectId).filter(
    (withdraw) => withdraw.environment === input.environment,
  )
  if (pending.length === 0) {
    return []
  }

  const config = contractEnvironmentConfig(input.environment)
  if (config.key !== 'sepolia') {
    return []
  }

  const provider = ensureEthereumProvider()
  input.setStatus('Checking pending Sepolia withdraw projection...')
  await ensureWalletChain(provider, config.walletChain)

  const accepted: PendingProjectWithdraw[] = []
  for (const withdraw of pending) {
    const proof = await publicDecryptSepoliaBool({
      handle: withdraw.withdrawCheckHandle,
      onRetry: ({ maxAttempts, nextAttempt }) => {
        input.setStatus(`Waiting for Sepolia pending withdraw proof (${nextAttempt}/${maxAttempts})...`)
      },
      provider,
      retries: 10,
    })
    if (proof.accepted) {
      accepted.push(withdraw)
    } else {
      clearPendingProjectWithdraw(withdraw.projectId, withdraw.chainTxHash)
    }
  }

  return accepted
}

function savePendingProjectWithdraw(withdraw: PendingProjectWithdraw) {
  const remaining = pendingProjectWithdraws().filter(
    (item) => item.projectId !== withdraw.projectId || item.chainTxHash !== withdraw.chainTxHash,
  )
  writePendingProjectWithdraws([...remaining, withdraw])
}

function writePendingProjectWithdraws(withdraws: PendingProjectWithdraw[]) {
  const storage = browserStorage()
  if (!storage) {
    return
  }

  storage.setItem(pendingWithdrawStorageKey, JSON.stringify(withdraws))
}

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function isPendingProjectWithdraw(value: unknown): value is PendingProjectWithdraw {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<PendingProjectWithdraw>
  return (
    typeof candidate.amountMinorUnits === 'number' &&
    typeof candidate.chainTxHash === 'string' &&
    typeof candidate.environment === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.recipientAddress === 'string' &&
    typeof candidate.savedAt === 'number' &&
    typeof candidate.settlementBucketCommitment === 'string' &&
    typeof candidate.withdrawalNonce === 'string' &&
    typeof candidate.withdrawCheckHandle === 'string'
  )
}

export function projectWithdrawPayload(withdraw: PendingProjectWithdraw) {
  return {
    amountMinorUnits: withdraw.amountMinorUnits,
    chainTxHash: withdraw.chainTxHash,
    recipientAddress: withdraw.recipientAddress,
    settlementBucketCommitment: withdraw.settlementBucketCommitment,
    withdrawalNonce: withdraw.withdrawalNonce,
    withdrawCheckHandle: withdraw.withdrawCheckHandle,
  }
}

async function runLocalPrivateWithdraw(input: {
  bucketCommitment: Hex
  config: ContractEnvironmentConfig
  deadline: number
  publicClient: BrowserPublicClient
  requestedAmount: bigint
  rpcUrl: string
  settlement: Hex
  setStatus: WithdrawStatusSetter
  signerAddress: Hex
  walletClient: BrowserWalletClient
  withdrawalNonce: Hex
}): Promise<SubmittedWithdraw> {
  const chainSubmitter = ensureHexAddress(input.config.manifest?.deployer ?? null, 'local-dev chain submitter')
  input.setStatus('Reading encrypted merchant pending balance...')
  const pendingHandle = (await input.publicClient.readContract({
    address: input.settlement,
    abi: privateCheckoutSettlementAbi,
    functionName: 'merchantPendingHandleOf',
    args: [input.bucketCommitment],
  })) as Hex
  const pending = await decryptLocalEuint64Handle(input.rpcUrl, pendingHandle)
  if (pending < input.requestedAmount) {
    throw new Error('On-chain encrypted merchant pending balance is lower than the dashboard projection. Refresh and try again.')
  }

  input.setStatus('Encrypting withdraw amount for the local chain submitter...')
  const encryptedAmount = await encryptLocalEuint64({
    amountMinorUnits: input.requestedAmount,
    chainId: input.config.chain.id,
    contractAddress: input.settlement,
    rpcUrl: input.rpcUrl,
    userAddress: chainSubmitter,
  })
  input.setStatus('Sign withdraw authorization...')
  const authorization = await signWithdrawAuthorization({ ...input, encryptedAmount })

  input.setStatus('Submitting signed withdraw through the local chain submitter...')
  const submitted = await submitLocalPrivateWithdraw({
    authorization,
    bucketOwner: input.signerAddress,
    deadline: input.deadline,
    encryptedAmount: encryptedAmount.handle,
    inputProof: encryptedAmount.inputProof,
    recipient: input.signerAddress,
    settlementBucketCommitment: input.bucketCommitment,
    withdrawalNonce: input.withdrawalNonce,
  })
  await input.publicClient.waitForTransactionReceipt({ hash: submitted.chainTxHash })
  return submitted
}

async function runSepoliaPrivateWithdraw(input: {
  bucketCommitment: Hex
  config: ContractEnvironmentConfig
  deadline: number
  provider: BrowserProvider
  publicClient: BrowserPublicClient
  requestedAmount: bigint
  settlement: Hex
  setStatus: WithdrawStatusSetter
  signerAddress: Hex
  walletClient: BrowserWalletClient
  withdrawalNonce: Hex
}): Promise<SubmittedWithdraw> {
  input.setStatus('Preparing private withdraw amount on Sepolia...')
  const encryptedAmount = await encryptSepoliaEuint64({
    amountMinorUnits: input.requestedAmount,
    contractAddress: input.settlement,
    provider: input.provider,
    userAddress: input.signerAddress,
  })
  input.setStatus('Sign withdraw authorization...')
  const authorization = await signWithdrawAuthorization({ ...input, encryptedAmount })

  input.setStatus('Confirm the Sepolia withdraw transaction...')
  const chainTxHash = await input.walletClient.writeContract({
    account: input.signerAddress,
    address: input.settlement,
    abi: privateCheckoutSettlementAbi,
    chain: input.config.chain,
    functionName: 'requestPrivateWithdraw',
    args: [
      input.bucketCommitment,
      input.withdrawalNonce,
      input.signerAddress,
      input.signerAddress,
      encryptedAmount.handle,
      encryptedAmount.inputProof,
      BigInt(input.deadline),
      authorization,
    ],
  })
  await input.publicClient.waitForTransactionReceipt({ hash: chainTxHash })
  const withdrawCheckHandle = (await input.publicClient.readContract({
    address: input.settlement,
    abi: privateCheckoutSettlementAbi,
    functionName: 'withdrawalCheckHandleOf',
    args: [input.withdrawalNonce],
  })) as Hex
  input.setStatus('Verifying encrypted withdraw result on Sepolia...')
  return { chainTxHash, withdrawCheckHandle }
}

async function signWithdrawAuthorization(input: {
  bucketCommitment: Hex
  config: ContractEnvironmentConfig
  deadline: number
  encryptedAmount: EncryptedWithdrawAmount
  settlement: Hex
  signerAddress: Hex
  walletClient: BrowserWalletClient
  withdrawalNonce: Hex
}): Promise<Hex> {
  const inputProofHash = keccak256(input.encryptedAmount.inputProof)
  return input.walletClient.signTypedData({
    account: input.signerAddress,
    domain: {
      name: 'ZamaPayPrivateCheckoutSettlement',
      version: '1',
      chainId: input.config.chain.id,
      verifyingContract: input.settlement,
    },
    primaryType: 'PrivateWithdraw',
    types: privateWithdrawAuthorizationTypes,
    message: {
      settlementBucketCommitment: input.bucketCommitment,
      withdrawalNonce: input.withdrawalNonce,
      bucketOwner: input.signerAddress,
      recipient: input.signerAddress,
      encryptedAmount: input.encryptedAmount.handle,
      inputProofHash,
      deadline: BigInt(input.deadline),
    },
  })
}

function ensureHexAddress(address: string | null, label: string): Hex {
  if (!address) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  try {
    return getAddress(address) as Hex
  } catch {
    throw new Error(`${label} is not a valid EVM address.`)
  }
}

function randomNonce(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

const privateWithdrawAuthorizationTypes = {
  PrivateWithdraw: [
    { name: 'settlementBucketCommitment', type: 'bytes32' },
    { name: 'withdrawalNonce', type: 'bytes32' },
    { name: 'bucketOwner', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'encryptedAmount', type: 'bytes32' },
    { name: 'inputProofHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

async function submitLocalPrivateWithdraw(payload: {
  authorization: Hex
  bucketOwner: Hex
  deadline: number
  encryptedAmount: Hex
  inputProof: Hex
  recipient: Hex
  settlementBucketCommitment: Hex
  withdrawalNonce: Hex
}): Promise<SubmittedWithdraw> {
  const response = await fetch('/api/dev/local-private-withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => ({})) as {
    chainTxHash?: Hex
    error?: string
    withdrawCheckHandle?: Hex
  }

  if (!response.ok) {
    throw new Error(body.error ?? `Local private withdraw submission failed with ${response.status}.`)
  }
  if (!body.chainTxHash || !body.withdrawCheckHandle) {
    throw new Error('Local private withdraw submission returned incomplete chain evidence.')
  }

  return {
    chainTxHash: body.chainTxHash,
    withdrawCheckHandle: body.withdrawCheckHandle,
  }
}
