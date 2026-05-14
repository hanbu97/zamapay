'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CopyIcon, CreditCardIcon, LockKeyholeIcon, RefreshCcwIcon, ShieldCheckIcon } from 'lucide-react'
import { bytesToHex, createPublicClient, createWalletClient, custom, getAddress, http } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { contractEnvironmentConfigs, contractEnvironmentForChainId } from '@/lib/contract-environment'
import { evmCheckoutSettlementAbi, privateCheckoutSettlementAbi } from '@/lib/contracts'
import { getInvoiceRecord, type EvmPaymentIntent, type PaymentRail, type SupportedEvmAsset } from '@/lib/api'
import { encryptLocalEuint64 } from '@/lib/local-fhevm-browser'
import { ensureEthereumProvider, ensureWalletChain, type WalletChain } from '@/lib/wallet'
import { encryptSepoliaEuint64, publicDecryptSepoliaBool } from '@/lib/zama-relayer-browser'

type HexAddress = `0x${string}`
type HexValue = `0x${string}`

type CheckoutPaymentCardProps = {
  amountLabel: string
  amountMinorUnits: number
  chainInvoiceId: number | null
  evmAsset: SupportedEvmAsset | null
  evmPaymentIntent: EvmPaymentIntent | null
  finalityStatus: string
  invoiceId: string
  manifestChainId: number | null
  merchantName: string
  paymentRail: PaymentRail
  paymentTruth: string
  settlementAddress: string | null
  title: string
  tokenAddress: string | null
}

const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const checkoutStatus = { accepted: 3, created: 1, expired: 5, rejected: 4, submitted: 2 } as const

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
  const message = caught instanceof Error ? caught.message : 'Payment failed.'

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

function initialPaymentStatus(paymentTruth: string, finalityStatus: string, paymentRail: PaymentRail) {
  if (isPaymentComplete(paymentTruth, finalityStatus)) {
    return 'Payment complete.'
  }

  return paymentRail === 'evm_erc20'
    ? 'Approve the exact ERC20 amount and pay through the settlement contract.'
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

async function projectFinalizedPayment(input: { chainInvoiceId: number; paymentTxHash?: HexValue }) {
  const response = await fetch('/api/checkout/project-finalized-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
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
  evmAsset,
  evmPaymentIntent,
  finalityStatus,
  invoiceId,
  manifestChainId,
  merchantName,
  paymentRail,
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
  const [preferredPayerAddress, setPreferredPayerAddress] = useState<HexAddress | null>(null)
  const [status, setStatus] = useState(() => initialPaymentStatus(paymentTruth, finalityStatus, paymentRail))

  const isEvmPayment = paymentRail === 'evm_erc20'
  const manifestEnvironment = contractEnvironmentForChainId(manifestChainId)
  const paymentEnvironment = manifestEnvironment ? contractEnvironmentConfigs[manifestEnvironment] : null
  const supportsPrivatePayment = manifestEnvironment === 'local-dev' || manifestEnvironment === 'sepolia'
  const isPaid = optimisticPaid || isPaymentComplete(paymentTruth, finalityStatus)
  const isPayable =
    paymentTruth === 'pending_payment' && (isEvmPayment ? evmPaymentIntent !== null : chainInvoiceId !== null)
  const canPay = isEvmPayment
    ? isPayable && Boolean(evmAsset) && Boolean(evmPaymentIntent)
    : isPayable && supportsPrivatePayment && Boolean(settlementAddress) && Boolean(tokenAddress)
  const paymentBadgeLabel = isPaid
    ? 'Success'
    : canPay
      ? isEvmPayment
        ? `${evmPaymentIntent?.network ?? 'EVM'} ready`
        : `${paymentEnvironment?.label ?? 'Chain'} ready`
      : isEvmPayment
        ? 'Awaiting ERC20 rail'
        : 'Awaiting private invoice'

  useEffect(() => {
    if (!isPaymentComplete(paymentTruth, finalityStatus)) {
      return
    }

    setError(null)
    setStatus(initialPaymentStatus(paymentTruth, finalityStatus, paymentRail))
  }, [finalityStatus, paymentRail, paymentTruth])

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const syncPreferredPayer = () => setPreferredPayerAddress(readPreferredPayerFromLocation())
    syncPreferredPayer()
    window.addEventListener('hashchange', syncPreferredPayer)
    return () => window.removeEventListener('hashchange', syncPreferredPayer)
  }, [])

  async function handlePayment() {
    setIsBusy(true)
    setError(null)
    setOptimisticPaid(false)

    try {
      if (isEvmPayment) {
        await handleEvmPayment()
        return
      }

      if (!canPay || chainInvoiceId === null) {
        throw new Error('This checkout is not ready for browser payment.')
      }

      if (amountMinorUnits <= 0) {
        throw new Error('Invoice amount must be greater than zero.')
      }

      const provider = ensureEthereumProvider()

      if (paymentEnvironment && supportsPrivatePayment) {
        const settlement = ensureHexAddress(settlementAddress, 'PrivateCheckoutSettlement')
        ensureHexAddress(tokenAddress, 'ConfidentialUSDMock')
        const rpcUrl = paymentEnvironment.walletChain.rpcUrls[0]
        if (!rpcUrl) {
          throw new Error(`${paymentEnvironment.label} RPC URL is missing from the wallet chain.`)
        }

        setStatus(`Switching wallet to ${paymentEnvironment.walletChain.name}...`)
        await ensureWalletChain(provider, paymentEnvironment.walletChain)

        const walletClient = createWalletClient({ chain: paymentEnvironment.chain, transport: custom(provider) })
        const publicClient = createPublicClient({ chain: paymentEnvironment.chain, transport: http(rpcUrl) })
        const payerAddress = await resolvePayerAddress({
          provider,
          preferredPayerAddress,
          setStatus,
        })
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
          const encryptedPayment =
            manifestEnvironment === 'local-dev'
              ? await encryptLocalEuint64({
                  amountMinorUnits: BigInt(amountMinorUnits),
                  chainId: manifestChainId ?? paymentEnvironment.chain.id,
                  contractAddress: settlement,
                  rpcUrl,
                  userAddress: payerAddress,
                })
              : await encryptSepoliaEuint64({
                  amountMinorUnits: BigInt(amountMinorUnits),
                  contractAddress: settlement,
                  provider,
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
        if (manifestEnvironment === 'local-dev') {
          await projectFinalizedPayment({ chainInvoiceId })
        } else {
          const paymentCheckHandle = (await publicClient.readContract({
            address: settlement,
            abi: privateCheckoutSettlementAbi,
            functionName: 'paymentCheckHandleOf',
            args: [orderCommitment],
          })) as HexValue
          const proof = await publicDecryptSepoliaBool({ handle: paymentCheckHandle, provider })
          if (!proof.accepted) {
            throw new Error('PrivatePaymentFinalized was rejected.')
          }

          setStatus('Confirm finalization in your wallet.')
          const finalizationTxHash = await walletClient.writeContract({
            account: payerAddress,
            address: settlement,
            abi: privateCheckoutSettlementAbi,
            functionName: 'finalizePrivatePayment',
            args: [orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof],
          })
          await publicClient.waitForTransactionReceipt({ hash: finalizationTxHash })
          const projected = await waitForPaymentProjection({
            invoiceId,
            projectPayment: projectFinalizedPayment({ chainInvoiceId, paymentTxHash: finalizationTxHash }),
          })
          if (projected) {
            completePayment()
            return
          }
        }

        completePayment()
        return
      }

      throw new Error('This checkout has no supported private payment environment.')
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Encrypted payment did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleEvmPayment() {
    if (!canPay || !evmPaymentIntent || !evmAsset) {
      throw new Error('This checkout has no supported ERC20 payment asset.')
    }

    if (amountMinorUnits <= 0) {
      throw new Error('Invoice amount must be greater than zero.')
    }

    const token = ensureHexAddress(evmPaymentIntent.tokenContract, 'ERC20 token')
    const settlement = ensureHexAddress(evmPaymentIntent.settlementContract, 'EvmCheckoutSettlement')
    const provider = ensureEthereumProvider()
    const walletChain = evmAssetWalletChain(evmAsset)
    const payerAddress = await resolvePayerAddress({
      provider,
      preferredPayerAddress,
      setStatus,
    })

    setStatus(`Switching wallet to ${walletChain.name}...`)
    await ensureWalletChain(provider, walletChain)

    setStatus(`Approve ${amountLabel} ${evmPaymentIntent.tokenSymbol} for settlement.`)
    const walletClient = createWalletClient({ transport: custom(provider) })
    const publicClient = createPublicClient({ transport: http(evmAsset.rpcUrl) })
    const approveHash = await walletClient.writeContract({
      account: payerAddress,
      chain: null,
      address: token,
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [settlement, BigInt(evmPaymentIntent.expectedAmountMinorUnits)],
    })

    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    setStatus('Confirm settlement payment.')
    const paymentHash = await walletClient.writeContract({
      account: payerAddress,
      chain: null,
      address: settlement,
      abi: evmCheckoutSettlementAbi,
      functionName: 'pay',
      args: [
        evmPaymentIntent.settlementIntentId as HexValue,
        evmPaymentIntent.settlementProjectId as HexValue,
        token,
        BigInt(evmPaymentIntent.expectedAmountMinorUnits),
        BigInt(evmPaymentIntent.merchantNetMinorUnits),
        BigInt(evmPaymentIntent.platformFeeMinorUnits),
        BigInt(Math.floor(new Date(evmPaymentIntent.expiresAt).getTime() / 1000)),
      ],
    })

    await publicClient.waitForTransactionReceipt({ hash: paymentHash })
    setStatus('Payment accepted by settlement. Waiting for indexer confirmations...')

    const projected = await waitForEvmPaymentProjection(invoiceId)
    if (projected) {
      completePayment()
      return
    }

    setStatus('Payment accepted by settlement. Refreshing while the indexer confirms it.')
    router.refresh()
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
            {isEvmPayment ? 'ERC20 hosted checkout' : 'Secure hosted checkout'}
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

        {isEvmPayment ? (
          <div className="rounded-[8px] border bg-background/70 p-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <CheckoutDetail label="Network" value={evmPaymentIntent?.network ?? 'Unavailable'} />
              <CheckoutDetail label="Token" value={evmPaymentIntent?.tokenSymbol ?? 'Unavailable'} />
              <CheckoutDetail
                className="sm:col-span-2"
                label="Settlement contract"
                value={evmPaymentIntent?.settlementContract ?? 'Unavailable'}
              />
              <CheckoutDetail label="Status" value={formatIntentStatus(evmPaymentIntent?.status)} />
              <CheckoutDetail label="Expires" value={formatDateTime(evmPaymentIntent?.expiresAt)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={!evmPaymentIntent}
                onClick={() =>
                  void copyEvmAddress(evmPaymentIntent?.settlementContract, setStatus)
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <CopyIcon data-icon="inline-start" />
                Copy contract
              </Button>
              <Button onClick={() => router.refresh()} size="sm" type="button" variant="outline">
                <RefreshCcwIcon data-icon="inline-start" />
                Refresh status
              </Button>
            </div>
          </div>
        ) : null}

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
              <div className="text-sm font-medium">
                {isPaid ? 'Success' : isEvmPayment ? 'Ready for ERC20 settlement' : 'Ready for private payment'}
              </div>
              <p className={isPaid ? 'mt-1 text-sm text-emerald-800' : 'mt-1 text-sm text-muted-foreground'}>
                {status}
              </p>
              {preferredPayerAddress && !isPaid ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>CardForge wallet {shortHex(preferredPayerAddress)}</span>
                  <button
                    className="rounded-full border px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={() => {
                      setPreferredPayerAddress(null)
                      removePreferredPayerFromLocation()
                      setStatus('Wallet selected in MetaMask will pay this checkout.')
                    }}
                    type="button"
                  >
                    Use another wallet
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Payment failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!canPay && !isPaid ? (
          <Alert>
            <AlertTitle>Payment unavailable</AlertTitle>
            <AlertDescription>
              {isEvmPayment
                ? 'No enabled settlement contract is available for this ERC20 asset.'
                : 'No deployed private checkout manifest is available for this chain.'}
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {!isPaid ? (
        <CardFooter className="flex-col items-stretch gap-3 px-5 pb-5 sm:px-7 sm:pb-7">
          <Button className="h-12 w-full text-base" disabled={!canPay || isBusy} onClick={handlePayment} type="button">
            {isBusy ? <Spinner data-icon="inline-start" /> : <CreditCardIcon data-icon="inline-start" />}
            {paymentButtonLabel({ canPay, isBusy, paymentRail })}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function CheckoutDetail({ className = '', label, value }: { className?: string; label: string; value: string }) {
  return (
    <div className={className}>
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-xs text-foreground">{value}</div>
    </div>
  )
}

function paymentButtonLabel({
  canPay,
  isBusy,
  paymentRail,
}: {
  canPay: boolean
  isBusy: boolean
  paymentRail: PaymentRail
}) {
  if (isBusy) {
    return 'Processing payment...'
  }

  if (!canPay) {
    return 'Payment unavailable'
  }

  return paymentRail === 'evm_erc20' ? 'Pay through settlement' : 'Pay confidentially'
}

async function waitForPaymentProjection(input: { invoiceId: string; projectPayment: Promise<void> }): Promise<boolean> {
  try {
    await input.projectPayment
    return true
  } catch (caught) {
    if (await isProjectedPaid(input.invoiceId)) {
      return true
    }

    throw caught
  }
}

async function isProjectedPaid(invoiceId: string): Promise<boolean> {
  const invoice = await getInvoiceRecord(invoiceId).catch(() => null)
  return Boolean(invoice && isPaymentComplete(invoice.snapshot.paymentTruth, invoice.snapshot.finalityStatus))
}

async function waitForEvmPaymentProjection(invoiceId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(2_500)
    if (await isProjectedPaid(invoiceId)) {
      return true
    }
  }

  return false
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function copyEvmAddress(address: string | null | undefined, setStatus: (status: string) => void) {
  if (!address) {
    setStatus('No settlement contract is available.')
    return
  }

  try {
    await navigator.clipboard.writeText(address)
    setStatus('Settlement contract copied.')
  } catch {
    setStatus('Clipboard permission denied. Select the settlement contract and copy it manually.')
  }
}

function evmAssetWalletChain(asset: SupportedEvmAsset): WalletChain {
  return {
    id: asset.chainId,
    name: asset.network,
    nativeCurrency: {
      decimals: 18,
      name: asset.nativeSymbol,
      symbol: asset.nativeSymbol,
    },
    rpcUrls: [asset.rpcUrl],
  }
}

function formatIntentStatus(status: EvmPaymentIntent['status'] | undefined) {
  switch (status) {
    case 'confirmed':
      return 'Confirmed'
    case 'detected':
      return 'Detected'
    case 'underpaid':
      return 'Underpaid'
    case 'overpaid':
      return 'Overpaid'
    case 'expired':
      return 'Expired'
    case 'failed':
      return 'Failed'
    case 'requires_payment':
      return 'Awaiting settlement'
    default:
      return 'Unavailable'
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Unavailable'
  }
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
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

function readPreferredPayerFromLocation(): HexAddress | null {
  if (typeof window === 'undefined') {
    return null
  }

  const current = new URL(window.location.href)
  return normalizeAddress(current.hash.replace(/^#/, ''), 'payer') ?? normalizeAddress(current.search, 'preferredPayer')
}

function normalizeAddress(paramsText: string, key: string): HexAddress | null {
  const raw = new URLSearchParams(paramsText).get(key)
  if (!raw) {
    return null
  }

  try {
    return getAddress(raw) as HexAddress
  } catch {
    return null
  }
}

function removePreferredPayerFromLocation() {
  const current = new URL(window.location.href)
  const hash = new URLSearchParams(current.hash.replace(/^#/, ''))
  hash.delete('payer')
  current.hash = hash.toString()
  window.history.replaceState(null, '', current.toString())
}

async function resolvePayerAddress({
  preferredPayerAddress,
  provider,
  setStatus,
}: {
  preferredPayerAddress: HexAddress | null
  provider: ReturnType<typeof ensureEthereumProvider>
  setStatus: (status: string) => void
}): Promise<HexAddress> {
  if (preferredPayerAddress) {
    return resolvePreferredPayerAddress(provider, preferredPayerAddress, setStatus)
  }

  return resolveSelectedPayerAddress(provider)
}

async function resolvePreferredPayerAddress(
  provider: ReturnType<typeof ensureEthereumProvider>,
  preferredPayerAddress: HexAddress,
  setStatus: (status: string) => void,
): Promise<HexAddress> {
  const initialAccounts = normalizedWalletAccounts(await provider.request({ method: 'eth_accounts' }))
  if (hasWalletAccount(initialAccounts, preferredPayerAddress)) {
    return preferredPayerAddress
  }

  setStatus(`Select CardForge wallet ${shortHex(preferredPayerAddress)} in MetaMask.`)
  await provider.request({
    method: 'wallet_requestPermissions',
    params: [{ eth_accounts: {} }],
  })
  const accounts = normalizedWalletAccounts(await provider.request({ method: 'eth_accounts' }))
  if (hasWalletAccount(accounts, preferredPayerAddress)) {
    return preferredPayerAddress
  }

  const selected = accounts[0] ? ` Current wallet is ${shortHex(accounts[0])}.` : ''
  throw new Error(`Select CardForge wallet ${shortHex(preferredPayerAddress)} to pay from the demo balance.${selected}`)
}

async function resolveSelectedPayerAddress(provider: ReturnType<typeof ensureEthereumProvider>): Promise<HexAddress> {
  const accounts = normalizedWalletAccounts(await provider.request({ method: 'eth_requestAccounts' }))
  const selected = accounts[0]
  if (!selected) {
    throw new Error('MetaMask returned no selected account.')
  }

  return selected
}

function normalizedWalletAccounts(value: unknown): HexAddress[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((account) => {
    if (typeof account !== 'string') {
      return []
    }

    try {
      return [getAddress(account) as HexAddress]
    } catch {
      return []
    }
  })
}

function hasWalletAccount(accounts: HexAddress[], address: HexAddress) {
  return accounts.some((account) => account.toLowerCase() === address.toLowerCase())
}

function shortHex(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value
}

function randomNonce(): HexValue {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}
