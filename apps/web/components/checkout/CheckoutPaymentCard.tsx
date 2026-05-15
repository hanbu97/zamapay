'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2Icon, CopyIcon, CreditCardIcon, LockKeyholeIcon, RefreshCcwIcon, ShieldCheckIcon } from 'lucide-react'
import { createPublicClient, createWalletClient, custom, hexToSignature, http, maxUint256 } from 'viem'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { contractEnvironmentConfigs, contractEnvironmentForChainId } from '@/lib/contract-environment'
import { evmCheckoutSettlementAbi, privateCheckoutSettlementAbi } from '@/lib/contracts'
import {
  getEvmPaymentActions,
  submitEvmRelayedPayment,
  type EvmPaymentIntent,
  type PaymentRail,
  type SupportedEvmAsset,
} from '@/lib/api'
import { encryptLocalEuint64 } from '@/lib/local-fhevm-browser'
import { ensureEthereumProvider, ensureWalletChain } from '@/lib/wallet'
import { encryptSepoliaEuint64, publicDecryptSepoliaBool } from '@/lib/zama-relayer-browser'
import {
  ensureHexAddress,
  formatDateTime,
  initialPaymentStatus,
  isPaymentComplete,
  projectFinalizedPayment,
  randomNonce,
  readableError,
  readPreferredPayerFromLocation,
  removePreferredPayerFromLocation,
  resolvePayerAddress,
  scheduleReturnToMerchant,
  shortHex,
  shortInvoiceId,
  waitForEvmPaymentProjection,
  waitForPaymentProjection,
} from './checkout-helpers'
import {
  copyEvmAddress,
  erc20AllowanceAbi,
  erc20ApproveAbi,
  erc20PermitNonceAbi,
  evmAssetWalletChain,
  evmSettlementPaymentParams,
  estimateSettlementGas,
  formatFundingMethod,
  formatIntentStatus,
  normalizeTypedData,
  permit2PaymentArgs,
  selectBrowserFundingAction,
  type HexAddress,
  type HexValue,
} from './evm-funding'

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

const checkoutStatus = { accepted: 3, created: 1, expired: 5, rejected: 4, submitted: 2 } as const

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
  const [selectedFundingMethod, setSelectedFundingMethod] = useState<string | null>(null)
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

    setStatus(`Preparing ${amountLabel} ${evmPaymentIntent.tokenSymbol} settlement.`)
    const walletClient = createWalletClient({ transport: custom(provider) })
    const publicClient = createPublicClient({ transport: http(evmAsset.rpcUrl) })
    setStatus('Resolving supported funding methods...')
    const actions = await getEvmPaymentActions(invoiceId, payerAddress)
    const action = selectBrowserFundingAction(actions.actions)
    if (!action) {
      throw new Error('No browser-supported ERC20 funding method is available for this asset.')
    }
    setSelectedFundingMethod(action.gasless ? `${action.method}_relayed` : action.method)
    const paymentParams = evmSettlementPaymentParams(evmPaymentIntent, token)

    let paymentHash: HexValue | null = null
    if (action.method === 'eip3009') {
      setStatus('Sign the token authorization for this checkout.')
      const typedData = normalizeTypedData(action)
      const signature = await walletClient.signTypedData({
        account: payerAddress,
        domain: typedData.domain,
        message: typedData.message,
        primaryType: typedData.primaryType,
        types: typedData.types,
      })
      const split = hexToSignature(signature)
      setStatus(action.gasless ? 'Sending the signed authorization to the relayer.' : 'Submit the authorized payment to settlement.')
      const authorization = {
        payer: payerAddress,
        validAfter: BigInt(typedData.message.validAfter),
        validBefore: BigInt(typedData.message.validBefore),
        nonce: typedData.message.nonce as HexValue,
        v: Number(split.v),
        r: split.r,
        s: split.s,
      }
      if (action.gasless) {
        try {
          setStatus('Submitting authorized payment through the ZamaPay relayer.')
          const relayed = await submitEvmRelayedPayment(invoiceId, {
            method: 'eip3009',
            payerAddress,
            signature,
          })
          paymentHash = relayed.chainTxHash as HexValue
        } catch (caught) {
          setStatus(`Relayer unavailable (${readableError(caught)}). Confirm settlement directly in your wallet.`)
        }
      }
      if (!paymentHash) {
        const gas = await estimateSettlementGas('eip3009', () =>
          publicClient.estimateContractGas({
            account: payerAddress,
            address: settlement,
            abi: evmCheckoutSettlementAbi,
            functionName: 'payWithAuthorization',
            args: [paymentParams, authorization],
          }),
        )
        paymentHash = await walletClient.writeContract({
          account: payerAddress,
          address: settlement,
          abi: evmCheckoutSettlementAbi,
          functionName: 'payWithAuthorization',
          gas,
          args: [paymentParams, authorization],
          chain: null,
        })
      }
    } else if (action.method === 'permit2') {
      const permit2 = permit2PaymentArgs(action)
      const approvalTarget = ensureHexAddress(action.approvalTarget, 'Permit2')
      const currentAllowance = await publicClient.readContract({
        address: token,
        abi: erc20AllowanceAbi,
        functionName: 'allowance',
        args: [payerAddress, approvalTarget],
      })
      if (currentAllowance < BigInt(evmPaymentIntent.expectedAmountMinorUnits)) {
        setStatus('Approve Permit2 token access for future settlement payments.')
        const approveHash = await walletClient.writeContract({
          account: payerAddress,
          chain: null,
          address: token,
          abi: erc20ApproveAbi,
          functionName: 'approve',
          args: [approvalTarget, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
      }

      setStatus('Sign the Permit2 witness for this checkout.')
      const typedData = normalizeTypedData(action)
      const signature = await walletClient.signTypedData({
        account: payerAddress,
        domain: typedData.domain,
        message: typedData.message,
        primaryType: typedData.primaryType,
        types: typedData.types,
      })
      setStatus(action.gasless ? 'Sending the signed Permit2 witness to the relayer.' : 'Submit the Permit2 payment to settlement.')
      const permit2Payment = {
        ...permit2,
        signature,
      }
      if (action.gasless) {
        try {
          setStatus('Submitting Permit2 payment through the ZamaPay relayer.')
          const relayed = await submitEvmRelayedPayment(invoiceId, {
            method: 'permit2',
            payerAddress,
            signature,
          })
          paymentHash = relayed.chainTxHash as HexValue
        } catch (caught) {
          setStatus(`Relayer unavailable (${readableError(caught)}). Confirm settlement directly in your wallet.`)
        }
      }
      if (!paymentHash) {
        const gas = await estimateSettlementGas('permit2', () =>
          publicClient.estimateContractGas({
            account: payerAddress,
            address: settlement,
            abi: evmCheckoutSettlementAbi,
            functionName: 'payWithPermit2',
            args: [paymentParams, permit2Payment],
          }),
        )
        paymentHash = await walletClient.writeContract({
          account: payerAddress,
          address: settlement,
          abi: evmCheckoutSettlementAbi,
          functionName: 'payWithPermit2',
          gas,
          args: [paymentParams, permit2Payment],
          chain: null,
        })
      }
    } else if (action.method === 'erc2612') {
      const permitTemplate = normalizeTypedData(action)
      const nonce = await publicClient.readContract({
        address: token,
        abi: erc20PermitNonceAbi,
        functionName: 'nonces',
        args: [payerAddress],
      })
      setStatus('Sign the token permit for this checkout.')
      const message = { ...permitTemplate.message, nonce }
      const signature = await walletClient.signTypedData({
        account: payerAddress,
        domain: permitTemplate.domain,
        message,
        primaryType: permitTemplate.primaryType,
        types: permitTemplate.types,
      })
      const split = hexToSignature(signature)
      setStatus('Submit the permitted payment to settlement.')
      const permit = {
        deadline: BigInt(permitTemplate.message.deadline),
        v: Number(split.v),
        r: split.r,
        s: split.s,
      }
      const gas = await estimateSettlementGas('erc2612', () =>
        publicClient.estimateContractGas({
          account: payerAddress,
          address: settlement,
          abi: evmCheckoutSettlementAbi,
          functionName: 'payWithPermit',
          args: [paymentParams, permit],
        }),
      )
      paymentHash = await walletClient.writeContract({
        account: payerAddress,
        chain: null,
        address: settlement,
        abi: evmCheckoutSettlementAbi,
        functionName: 'payWithPermit',
        gas,
        args: [paymentParams, permit],
      })
    } else {
      setStatus(`Approve ${amountLabel} ${evmPaymentIntent.tokenSymbol} for settlement.`)
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
      const payArgs = [
        evmPaymentIntent.settlementIntentId as HexValue,
        evmPaymentIntent.settlementProjectId as HexValue,
        token,
        BigInt(evmPaymentIntent.expectedAmountMinorUnits),
        BigInt(evmPaymentIntent.merchantNetMinorUnits),
        BigInt(evmPaymentIntent.platformFeeMinorUnits),
        BigInt(Math.floor(new Date(evmPaymentIntent.expiresAt).getTime() / 1000)),
      ] as const
      const gas = await estimateSettlementGas('approve_pay', () =>
        publicClient.estimateContractGas({
          account: payerAddress,
          address: settlement,
          abi: evmCheckoutSettlementAbi,
          functionName: 'pay',
          args: payArgs,
        }),
      )
      paymentHash = await walletClient.writeContract({
        account: payerAddress,
        chain: null,
        address: settlement,
        abi: evmCheckoutSettlementAbi,
        functionName: 'pay',
        gas,
        args: payArgs,
      })
    }

    if (!paymentHash) {
      throw new Error('Payment submission did not return a settlement transaction hash.')
    }

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
              <CheckoutDetail label="Funding method" value={formatFundingMethod(selectedFundingMethod)} />
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

  return paymentRail === 'evm_erc20' ? 'Pay with best available method' : 'Pay confidentially'
}
