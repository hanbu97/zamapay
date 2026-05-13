import { NextResponse } from 'next/server'
import { getAddress, isHex, type Hex } from 'viem'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseLocalDevServerBridge } from '@/lib/dev-signer-gate'
import { submitLocalPrivateWithdraw } from '@/lib/local-fhevm-dev'

type LocalPrivateWithdrawRequest = {
  authorization?: unknown
  bucketOwner?: unknown
  deadline?: unknown
  encryptedAmount?: unknown
  inputProof?: unknown
  recipient?: unknown
  settlementBucketCommitment?: unknown
  withdrawalNonce?: unknown
}

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    canUseLocalDevServerBridge({
      contractEnv: serverContractEnvironment(),
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function requiredHex(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value)) {
    throw new Error(`${field} must be a hex string.`)
  }

  return value as Hex
}

function requiredAddress(value: unknown, field: string): Hex {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be an address.`)
  }

  return getAddress(value) as Hex
}

function requiredDeadline(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('deadline must be a positive safe integer.')
  }

  return value
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local private withdraw submitter is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as LocalPrivateWithdrawRequest

  try {
    const submitted = await submitLocalPrivateWithdraw({
      authorization: requiredHex(body.authorization, 'authorization'),
      bucketOwner: requiredAddress(body.bucketOwner, 'bucketOwner'),
      deadline: requiredDeadline(body.deadline),
      encryptedAmount: requiredHex(body.encryptedAmount, 'encryptedAmount'),
      inputProof: requiredHex(body.inputProof, 'inputProof'),
      recipient: requiredAddress(body.recipient, 'recipient'),
      settlementBucketCommitment: requiredHex(body.settlementBucketCommitment, 'settlementBucketCommitment'),
      withdrawalNonce: requiredHex(body.withdrawalNonce, 'withdrawalNonce'),
    })

    return NextResponse.json(submitted)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local private withdraw submission failed'
    const status = message.includes('must be') || message.includes('requires') ? 400 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
