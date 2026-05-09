import { NextResponse } from 'next/server'
import { getAddress, isAddress, type Hex } from 'viem'
import { localDevAddresses } from '@/lib/contracts'
import { serverContractEnvironment } from '@/lib/contract-environment'
import { canUseDevSigner } from '@/lib/dev-signer-gate'
import { createLocalEncrypted64, readLocalConfidentialWallet } from '@/lib/local-fhevm-dev'

type LocalPaymentInputsRequest = {
  amountMinorUnits?: unknown
  chainInvoiceId?: unknown
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

export async function POST(request: Request) {
  if (!isEnabled(request)) {
    return NextResponse.json({ error: 'local confidential payment input bridge is disabled' }, { status: 404 })
  }

  const body = (await request.json().catch(() => ({}))) as LocalPaymentInputsRequest
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

  const tokenAddress = localDevAddresses.contracts.ConfidentialUSDMock
  const settlementAddress = localDevAddresses.contracts.ConfidentialInvoiceSettlement
  if (!tokenAddress || !settlementAddress) {
    return NextResponse.json({ error: 'local-dev confidential contracts are not deployed.' }, { status: 409 })
  }

  try {
    const payerAddress = getAddress(body.payerAddress) as Hex
    const balance = await readLocalConfidentialWallet({ address: payerAddress })
    const requiredAmount = BigInt(amountMinorUnits)

    if (BigInt(balance.balanceMinorUnits) < requiredAmount) {
      return NextResponse.json(
        {
          balanceMinorUnits: balance.balanceMinorUnits,
          error: 'Local confidential balance is too low. Connect the CardForge wallet panel first to fund dev cUSDT.',
        },
        { status: 409 },
      )
    }

    const approval = await createLocalEncrypted64({
      amountMinorUnits: requiredAmount,
      contractAddress: tokenAddress,
      userAddress: payerAddress,
    })
    const payment = await createLocalEncrypted64({
      amountMinorUnits: requiredAmount,
      contractAddress: settlementAddress,
      userAddress: payerAddress,
    })

    return NextResponse.json({
      approval,
      balanceMinorUnits: balance.balanceMinorUnits,
      chainInvoiceId,
      payment,
      settlementAddress,
      tokenAddress,
    })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'local confidential payment input creation failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
