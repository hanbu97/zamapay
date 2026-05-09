import { NextResponse } from 'next/server'
import { getAddress, isAddress, keccak256, toBytes, verifyMessage, type Hex } from 'viem'
import { localDevAddresses } from '@/lib/contracts'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { submitLocalPrivateCheckoutPayment } from '@/lib/local-fhevm-dev'

type PrivateCheckoutPaymentRequest = {
  amountMinorUnits?: unknown
  chainInvoiceId?: unknown
  intentMessage?: unknown
  intentSignature?: unknown
  payerAddress?: unknown
}

function isEnabled(request: Request) {
  return (
    serverContractEnvironment() === 'local-dev' &&
    canUseDevSigner({
      contractEnv: process.env.NEXT_PUBLIC_CONTRACT_ENV,
      enableDevSigner: process.env.MERMER_ENABLE_DEV_SIGNER,
      nodeEnv: process.env.NODE_ENV,
      requestUrl: request.url,
    })
  )
}

function readNonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function readPositiveSafeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function isHexSignature(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)
}

function privateCheckoutIntentMessage(input: {
  amountMinorUnits: number
  chainId: number
  chainInvoiceId: number
  payerAddress: string
  paymentRailAddress: string
  settlementAddress: string
}) {
  return [
    'Mermer Pay Private Checkout',
    `Chain ID: ${input.chainId}`,
    `Settlement: ${input.settlementAddress}`,
    `Payment rail: ${input.paymentRailAddress}`,
    `Invoice: ${input.chainInvoiceId}`,
    `Amount minor units: ${input.amountMinorUnits}`,
    `Payer: ${input.payerAddress}`,
  ].join('\n')
}

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local private checkout bridge is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as PrivateCheckoutPaymentRequest
  const chainInvoiceId = readNonNegativeSafeInteger(body.chainInvoiceId)
  const amountMinorUnits = readPositiveSafeInteger(body.amountMinorUnits)

  if (chainInvoiceId === null) {
    return NextResponse.json({ error: 'chainInvoiceId must be a non-negative integer.' }, { status: 400 })
  }
  if (amountMinorUnits === null) {
    return NextResponse.json({ error: 'amountMinorUnits must be a positive integer.' }, { status: 400 })
  }
  if (typeof body.payerAddress !== 'string' || !isAddress(body.payerAddress)) {
    return NextResponse.json({ error: 'payerAddress must be a valid wallet address.' }, { status: 400 })
  }
  if (typeof body.intentMessage !== 'string') {
    return NextResponse.json({ error: 'intentMessage is required.' }, { status: 400 })
  }
  if (!isHexSignature(body.intentSignature)) {
    return NextResponse.json({ error: 'intentSignature must be a hex signature.' }, { status: 400 })
  }

  const settlementAddress = localDevAddresses.contracts.PrivateCheckoutSettlement
  const paymentRailAddress = localDevAddresses.contracts.MockConfidentialPaymentRail
  if (!settlementAddress || !paymentRailAddress) {
    return NextResponse.json({ error: 'local-dev private checkout contracts are not deployed.' }, { status: 409 })
  }

  try {
    const payerAddress = getAddress(body.payerAddress)
    const expectedMessage = privateCheckoutIntentMessage({
      amountMinorUnits,
      chainId: localDevAddresses.chainId ?? 31337,
      chainInvoiceId,
      payerAddress,
      paymentRailAddress,
      settlementAddress,
    })

    if (body.intentMessage !== expectedMessage) {
      return NextResponse.json({ error: 'payment intent does not match this checkout.' }, { status: 400 })
    }

    const signatureMatches = await verifyMessage({
      address: payerAddress,
      message: expectedMessage,
      signature: body.intentSignature,
    })
    if (!signatureMatches) {
      return NextResponse.json({ error: 'payment intent signature is invalid.' }, { status: 401 })
    }

    const paymentNonce = keccak256(toBytes(`${payerAddress}:${chainInvoiceId}:${body.intentSignature}`))
    const result = await submitLocalPrivateCheckoutPayment({
      amountMinorUnits: BigInt(amountMinorUnits),
      chainInvoiceId,
      payerAddress,
      paymentNonce,
    })

    return NextResponse.json(result)
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local private checkout payment failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
