'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CreditCardIcon, LockKeyholeIcon, ShieldCheckIcon } from 'lucide-react'
import { bytesToHex, createPublicClient, createWalletClient, custom, getAddress, http } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { contractEnvironmentConfigs, contractEnvironmentForChainId } from '@/lib/contract-environment'
import { privateCheckoutSettlementAbi } from '@/lib/contracts'
import { encryptLocalEuint64 } from '@/lib/local-fhevm-browser'
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

const checkoutStatus = {
  accepted: 3,
  created: 1,
  expired: 5,
  rejected: 4,
  submitted: 2,
} as const

function ensureHexAddress(address: string | null, label: string): HexAddress {
  if (!address) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  try {
    return getAddress(address) as HexAddress
  } catch {
    throw new Error(`${label} is not a valid EVM address.`)
  }
}

function readableError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : 'Confidential payment failed.'

  if (message.includes('User rejected')) {
    return 'Wallet request was rejected. Confirm the next wallet prompt to continue.'
  }

  const revertReason = message.match(/reverted with the following reason:\s*([^\n]+)/i)
  if (revertReason?.[1]) {
    return revertReason[1].trim()
  }

  const firstLine = message.split('\n')[0]?.trim() || message
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine
}

function isPaymentComplete(paymentTruth: string, finalityStatus: string) {
  return paymentTruth === 'paid' || finalityStatus === 'finality_safe'
}

function initialPaymentStatus(paymentTruth: string, finalityStatus: string) {
  return isPaymentComplete(paymentTruth, finalityStatus)
    ? 'Payment complete.'
    : 'Confirm the private payment with your wallet.'
}

function parseProjectionError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

async function finalizeAndProjectLocalPayment(chainInvoiceId: number) {
  const response = await fetch('/api/checkout/project-finalized-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chainInvoiceId }),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseProjectionError(text) || `Payment finalization failed with ${response.status}.`)
  }
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
  const redirectTimerRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [optimisticPaid, setOptimisticPaid] = useState(false)
  const [status, setStatus] = useState(() => initialPaymentStatus(paymentTruth, finalityStatus))

  const manifestEnvironment = contractEnvironmentForChainId(manifestChainId)
  const isLocalDevManifest = manifestEnvironment === 'local-dev'
  const isPaid = optimisticPaid || isPaymentComplete(paymentTruth, finalityStatus)
  const isPayable = paymentTruth === 'pending_payment' && chainInvoiceId !== null
  const canPayOnLocalDev = isPayable && isLocalDevManifest && Boolean(settlementAddress) && Boolean(tokenAddress)
  const canPay = canPayOnLocalDev
  const paymentBadgeLabel = isPaid ? 'Success' : canPay ? 'Local-dev ready' : 'Awaiting local-dev invoice'

  useEffect(() => {
    if (!isPaymentComplete(paymentTruth, finalityStatus)) {
      return
    }

    setError(null)
    setStatus(initialPaymentStatus(paymentTruth, finalityStatus))
  }, [finalityStatus, paymentTruth])

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  async function handlePayment() {
    setIsBusy(true)
    setError(null)
    setOptimisticPaid(false)

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
        ensureHexAddress(tokenAddress, 'ConfidentialUSDMock')
        const rpcUrl = paymentEnvironment.walletChain.rpcUrls[0]
        if (!rpcUrl) {
          throw new Error('Hardhat RPC URL is missing from the local-dev wallet chain.')
        }

        setStatus('Switching wallet to Hardhat Local...')
        await ensureWalletChain(provider, paymentEnvironment.walletChain)

        const walletClient = createWalletClient({ chain: paymentEnvironment.chain, transport: custom(provider) })
        const publicClient = createPublicClient({ chain: paymentEnvironment.chain, transport: http(rpcUrl) })
        const [selectedAddress] = await walletClient.requestAddresses()
        const payerAddress = getAddress(selectedAddress)
        const orderCommitment = await publicClient.readContract({
          address: settlement,
          abi: privateCheckoutSettlementAbi,
          functionName: 'orderCommitmentOf',
          args: [BigInt(chainInvoiceId)],
        })
        const currentCheckoutStatus = Number(
          await publicClient.readContract({
            address: settlement,
            abi: privateCheckoutSettlementAbi,
            functionName: 'statusOf',
            args: [orderCommitment],
          }),
        )

        if (currentCheckoutStatus === checkoutStatus.expired) {
          throw new Error('This checkout has expired. Return to CardForge and create a new order.')
        }

        if (currentCheckoutStatus === checkoutStatus.rejected) {
          throw new Error('This checkout was rejected. Return to CardForge and create a new order.')
        }

        if (currentCheckoutStatus === checkoutStatus.accepted) {
          completePayment()
          return
        }

        if (currentCheckoutStatus === checkoutStatus.created) {
          setStatus('Preparing private payment...')
          const encryptedPayment = await encryptLocalEuint64({
            amountMinorUnits: BigInt(amountMinorUnits),
            chainId: manifestChainId ?? paymentEnvironment.chain.id,
            contractAddress: settlement,
            rpcUrl,
            userAddress: payerAddress,
          })

          setStatus(`Confirm ${amountLabel} in your wallet.`)
          const paymentNonce = randomNonce()
          const paymentTxHash = await walletClient.writeContract({
            account: payerAddress,
            address: settlement,
            abi: privateCheckoutSettlementAbi,
            functionName: 'submitPrivatePayment',
            args: [orderCommitment, paymentNonce, encryptedPayment.handle, encryptedPayment.inputProof],
          })
          await publicClient.waitForTransactionReceipt({ hash: paymentTxHash })
        } else if (currentCheckoutStatus === checkoutStatus.submitted) {
          setStatus('Payment already submitted. Finishing securely...')
        } else {
          throw new Error('This checkout is not payable.')
        }

        setStatus('Finalizing private payment...')
        await finalizeAndProjectLocalPayment(chainInvoiceId)

        completePayment()
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

  function completePayment() {
    setOptimisticPaid(true)
    setStatus('Payment successful. Returning to CardForge...')
    redirectTimerRef.current = scheduleReturnToMerchant(() => router.refresh())
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
          <Badge
            className={isPaid ? 'border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-600' : undefined}
            variant={canPay || isPaid ? 'default' : 'secondary'}
          >
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

        <div
          className={
            isPaid
              ? 'rounded-[8px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-950'
              : 'rounded-[8px] border bg-background/70 p-4'
          }
        >
          <div className="flex items-start gap-3">
            <div
              className={
                isPaid
                  ? 'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white'
                  : 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
              }
            >
              {isPaid ? <CheckCircle2Icon className="size-4" /> : <LockKeyholeIcon className="size-4" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{isPaid ? 'Success' : 'Ready for private payment'}</div>
              <p className={isPaid ? 'mt-1 text-sm text-emerald-800' : 'mt-1 text-sm text-muted-foreground'}>
                {status}
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!isLocalDevManifest ? (
          <Alert>
            <AlertTitle>Payment unavailable</AlertTitle>
            <AlertDescription>
              Browser payment is limited to the local-dev private checkout rail in this MVP.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {!isPaid ? (
        <CardFooter className="flex-col items-stretch gap-3 px-5 pb-5 sm:px-7 sm:pb-7">
          <Button className="h-12 w-full text-base" disabled={!canPay || isBusy} onClick={handlePayment} type="button">
            {isBusy ? <Spinner data-icon="inline-start" /> : <CreditCardIcon data-icon="inline-start" />}
            {paymentButtonLabel({ canPay, isBusy })}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function paymentButtonLabel({ canPay, isBusy }: { canPay: boolean; isBusy: boolean }) {
  if (isBusy) {
    return 'Processing payment...'
  }

  return canPay ? 'Pay confidentially' : 'Payment unavailable'
}

function shortInvoiceId(invoiceId: string) {
  return invoiceId.length > 16 ? `${invoiceId.slice(0, 10)}...${invoiceId.slice(-6)}` : invoiceId
}

function scheduleReturnToMerchant(fallback: () => void) {
  return window.setTimeout(() => {
    const returnUrl = safeReferrerUrl()
    if (returnUrl) {
      window.location.assign(returnUrl)
      return
    }

    fallback()
  }, 1_250)
}

function safeReferrerUrl() {
  if (!document.referrer) {
    return null
  }

  try {
    const referrer = new URL(document.referrer)
    const current = new URL(window.location.href)
    if (referrer.href === current.href || referrer.origin === current.origin) {
      return null
    }

    return referrer.protocol === 'http:' || referrer.protocol === 'https:' ? referrer.toString() : null
  } catch {
    return null
  }
}

function randomNonce(): HexAddress {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}
