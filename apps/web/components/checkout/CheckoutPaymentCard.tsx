'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CreditCardIcon, LockKeyholeIcon, ShieldCheckIcon } from 'lucide-react'
import { createWalletClient, custom, getAddress } from 'viem'
import { StatusStepper, type StatusStepperItem } from '@/components/commerce/StatusStepper'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { contractEnvironmentConfigs, contractEnvironmentForChainId } from '@/lib/contract-environment'
import { ensureEthereumProvider, ensureWalletChain } from '@/lib/wallet'

type HexAddress = `0x${string}`

type CheckoutPaymentCardProps = {
  amountLabel: string
  amountMinorUnits: number
  chainInvoiceId: number | null
  finalityStatus: string
  invoiceId: string
  manifestChainId: number | null
  merchantName: string
  paymentTruth: string
  settlementAddress: string | null
  title: string
  tokenAddress: string | null
}

type PaymentStep = 'finalize' | 'intent' | 'invoice' | 'project' | 'submit'

const paymentStepOrder: Record<PaymentStep, number> = {
  invoice: 1,
  intent: 2,
  submit: 3,
  finalize: 4,
  project: 5,
}
function ensureHexAddress(address: string | null, label: string): HexAddress {
  if (!address?.startsWith('0x')) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  return address as HexAddress
}

function readableError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Confidential payment failed.'
}

function isPaymentComplete(paymentTruth: string, finalityStatus: string) {
  return paymentTruth === 'paid' || finalityStatus === 'finality_safe'
}

function initialPaymentStatus(paymentTruth: string, finalityStatus: string) {
  return isPaymentComplete(paymentTruth, finalityStatus)
    ? 'Payment already verified. Project backend can fulfill this order.'
    : 'Connect a buyer wallet to submit the encrypted payment.'
}

function parseProjectionError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

async function projectFinalizedPayment(paymentTxHash: HexAddress, chainInvoiceId?: number) {
  const response = await fetch('/api/checkout/project-finalized-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainInvoiceId, paymentTxHash }),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseProjectionError(text) || `Payment projection failed with ${response.status}.`)
  }
}

type LocalPrivateCheckoutPaymentResult = {
  accepted: boolean
  chainInvoiceId: number
  finalizeTxHash: HexAddress
  orderCommitment: HexAddress
  paymentCheckHandle: HexAddress
  paymentTxHash: HexAddress
}

async function submitLocalPrivateCheckout(input: {
  amountMinorUnits: number
  chainInvoiceId: number
  intentMessage: string
  intentSignature: HexAddress
  payerAddress: HexAddress
}): Promise<LocalPrivateCheckoutPaymentResult> {
  const response = await fetch('/api/dev/local-private-checkout/pay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseProjectionError(text) || `Local encrypted input creation failed with ${response.status}.`)
  }

  return JSON.parse(text) as LocalPrivateCheckoutPaymentResult
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

export function CheckoutPaymentCard({
  amountLabel,
  amountMinorUnits,
  chainInvoiceId,
  finalityStatus,
  invoiceId,
  manifestChainId,
  merchantName,
  paymentTruth,
  settlementAddress,
  title,
  tokenAddress,
}: CheckoutPaymentCardProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [finalizeHash, setFinalizeHash] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('intent')
  const [paymentHash, setPaymentHash] = useState<string | null>(null)
  const [status, setStatus] = useState(() => initialPaymentStatus(paymentTruth, finalityStatus))

  const manifestEnvironment = contractEnvironmentForChainId(manifestChainId)
  const isLocalDevManifest = manifestEnvironment === 'local-dev'
  const isPaid = isPaymentComplete(paymentTruth, finalityStatus)
  const isPayable = paymentTruth === 'pending_payment' && chainInvoiceId !== null
  const canPayOnLocalDev = isPayable && isLocalDevManifest && Boolean(settlementAddress) && Boolean(tokenAddress)
  const canPay = canPayOnLocalDev
  const paymentBadgeLabel = isPaid ? 'Payment verified' : canPay ? 'Local-dev ready' : 'Awaiting local-dev invoice'
  const paymentSteps = getPaymentSteps({
    canPay,
    chainInvoiceId,
    error,
    finalizeHash,
    finalityStatus,
    isBusy,
    paymentHash,
    paymentStep,
    paymentTruth,
  })

  useEffect(() => {
    if (!isPaymentComplete(paymentTruth, finalityStatus)) {
      return
    }

    setError(null)
    setStatus(initialPaymentStatus(paymentTruth, finalityStatus))
  }, [finalityStatus, paymentTruth])

  async function handlePayment() {
    setIsBusy(true)
    setError(null)
    setFinalizeHash(null)
    setPaymentHash(null)
    setPaymentStep('intent')

    try {
      if (!canPay || chainInvoiceId === null) {
        throw new Error('This checkout is not ready for browser payment.')
      }

      if (amountMinorUnits <= 0) {
        throw new Error('Invoice amount must be greater than zero.')
      }

      const provider = ensureEthereumProvider()

      if (canPayOnLocalDev) {
        const paymentEnvironment = contractEnvironmentConfigs['local-dev']
        const settlement = ensureHexAddress(settlementAddress, 'PrivateCheckoutSettlement')
        const paymentRail = ensureHexAddress(tokenAddress, 'MockConfidentialPaymentRail')

        setStatus('Switching wallet to Hardhat Local...')
        await ensureWalletChain(provider, paymentEnvironment.walletChain)

        const walletClient = createWalletClient({ chain: paymentEnvironment.chain, transport: custom(provider) })
        const [selectedAddress] = await walletClient.requestAddresses()
        const payerAddress = getAddress(selectedAddress)

        setPaymentStep('intent')
        setStatus('Signing private checkout payment intent...')
        const intentMessage = privateCheckoutIntentMessage({
          amountMinorUnits,
          chainId: manifestChainId ?? paymentEnvironment.chain.id,
          chainInvoiceId,
          payerAddress,
          paymentRailAddress: paymentRail,
          settlementAddress: settlement,
        })
        const intentSignature = await walletClient.signMessage({
          account: payerAddress,
          message: intentMessage,
        })

        setPaymentStep('submit')
        setStatus(`Relayer is submitting encrypted ${amountLabel} private checkout...`)
        const result = await submitLocalPrivateCheckout({
          amountMinorUnits,
          chainInvoiceId,
          intentMessage,
          intentSignature,
          payerAddress,
        })
        setPaymentHash(result.paymentTxHash)

        setPaymentStep('finalize')
        setStatus('Local relayer decrypted only the paid/rejected boolean...')
        if (!result.accepted) {
          throw new Error('Encrypted payment was rejected by the settlement proof.')
        }
        setFinalizeHash(result.finalizeTxHash)

        setPaymentStep('project')
        setStatus('Payment confirmed on local chain. Projecting backend read model...')
        await projectFinalizedPayment(result.finalizeTxHash, chainInvoiceId)

        setStatus('Encrypted payment projected. Refreshing fulfillment state...')
        router.refresh()
        return
      }

      throw new Error('This build only supports local-dev private checkout.')
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Encrypted payment did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card
      className="w-full max-w-[720px] rounded-[8px] border border-white/70 bg-background/95 shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur"
      size="sm"
    >
      <CardHeader className="gap-5 px-5 pt-5 sm:px-7 sm:pt-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Badge className="w-fit" variant="outline">
            <ShieldCheckIcon data-icon="inline-start" />
            Secure hosted checkout
          </Badge>
          <Badge variant={canPay || isPaid ? 'default' : 'secondary'}>
            <LockKeyholeIcon data-icon="inline-start" />
            {paymentBadgeLabel}
          </Badge>
        </div>
        <div className="flex flex-col gap-2">
          <CardTitle className="max-w-[28rem] text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
            {title}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{merchantName}</span>
            <span className="text-muted-foreground/70">Invoice {shortInvoiceId(invoiceId)}</span>
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 px-5 sm:px-7">
        <div className="rounded-[8px] border bg-muted/35 px-5 py-8 text-center sm:px-7 sm:py-10">
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="text-5xl font-semibold leading-none tracking-normal sm:text-6xl">{amountLabel}</span>
          </div>
        </div>

        <StatusStepper
          ariaLabel="Checkout payment steps"
          detailMode="active"
          orientation="horizontal"
          steps={paymentSteps}
        />

        <div className="rounded-[8px] border bg-background/70 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {isPaid ? <CheckCircle2Icon className="size-4" /> : <LockKeyholeIcon className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{isPaid ? 'Payment verified' : 'Ready for private payment'}</div>
              <p className="mt-1 text-sm text-muted-foreground">{status}</p>
            </div>
          </div>
        </div>

        {paymentHash ? (
          <Alert>
            <AlertTitle>Payment submission</AlertTitle>
            <AlertDescription>{paymentHash.slice(0, 18)}...</AlertDescription>
          </Alert>
        ) : null}

        {finalizeHash ? (
          <Alert>
            <AlertTitle>Finalization transaction</AlertTitle>
            <AlertDescription>{finalizeHash}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!isLocalDevManifest ? (
          <Alert>
            <AlertTitle>Browser payment locked</AlertTitle>
            <AlertDescription>
              Browser payment is limited to the local-dev private checkout rail in this MVP.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3 px-5 pb-5 sm:px-7 sm:pb-7">
        <Button className="h-12 w-full text-base" disabled={!canPay || isBusy || isPaid} onClick={handlePayment} type="button">
          {isBusy ? <Spinner data-icon="inline-start" /> : <CreditCardIcon data-icon="inline-start" />}
          {paymentButtonLabel({ canPay, isBusy, isPaid })}
        </Button>
        {!isPaid ? (
          <p className="text-center text-xs text-muted-foreground">
            Wallet signs a payment intent; the relayer submits the private checkout and only the paid result is public.
          </p>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function paymentButtonLabel({ canPay, isBusy, isPaid }: { canPay: boolean; isBusy: boolean; isPaid: boolean }) {
  if (isBusy) {
    return 'Processing payment...'
  }

  if (isPaid) {
    return 'Payment verified'
  }

  return canPay ? 'Pay confidentially' : 'Payment unavailable'
}

function getPaymentSteps({
  canPay,
  chainInvoiceId,
  error,
  finalizeHash,
  finalityStatus,
  isBusy,
  paymentHash,
  paymentStep,
  paymentTruth,
}: {
  canPay: boolean
  chainInvoiceId: number | null
  error: string | null
  finalizeHash: string | null
  finalityStatus: string
  isBusy: boolean
  paymentHash: string | null
  paymentStep: PaymentStep
  paymentTruth: string
}): StatusStepperItem[] {
  const isPaid = isPaymentComplete(paymentTruth, finalityStatus)
  const currentStep = error
    ? paymentStepOrder[paymentStep]
    : isBusy
      ? paymentStepOrder[paymentStep]
      : chainInvoiceId === null
        ? 1
        : isPaid
          ? 5
          : 2

  return [
    {
      description:
        chainInvoiceId === null
          ? 'Merchant checkout exists, but the chain invoice is not ready for buyer payment.'
          : `Settlement contract invoice #${chainInvoiceId} is ready.`,
      meta: chainInvoiceId === null ? 'waiting' : `#${chainInvoiceId}`,
      state: chainInvoiceId === null ? 'active' : 'complete',
      title: 'Invoice',
    },
    {
      description: canPay || isPaid
        ? 'Buyer wallet signs a local private checkout intent.'
        : 'Local-dev private checkout manifest is required before buyer payment.',
      state: stepState(2, currentStep, isBusy, error),
      title: 'Intent',
    },
    {
      description: paymentHash
        ? `${paymentHash.slice(0, 18)}...`
        : 'Encrypted local payment amount is submitted to the settlement contract.',
      state: paymentHash || isPaid ? 'complete' : stepState(3, currentStep, isBusy, error),
      title: 'Payment',
    },
    {
      description: finalizeHash
        ? `${finalizeHash.slice(0, 18)}...`
        : 'Local FHEVM mock decrypts only the paid/rejected boolean, then finalizes on chain.',
      state: finalizeHash || isPaid ? 'complete' : stepState(4, currentStep, isBusy, error),
      title: 'Verify',
    },
    {
      description: isPaid
        ? `Backend read model is paid; finality is ${finalityStatus.replaceAll('_', ' ')}.`
        : 'Rust projection updates checkout truth and emits signed project webhooks.',
      state: isPaid ? 'complete' : stepState(5, currentStep, isBusy, error),
      title: 'Fulfillment',
    },
  ]
}

function stepState(step: number, currentStep: number, isBusy: boolean, error: string | null): StatusStepperItem['state'] {
  if (step < currentStep) {
    return 'complete'
  }

  if (step === currentStep) {
    return isBusy && !error ? 'loading' : 'active'
  }

  return 'pending'
}

function shortInvoiceId(invoiceId: string) {
  return invoiceId.length > 16 ? `${invoiceId.slice(0, 10)}...${invoiceId.slice(-6)}` : invoiceId
}
