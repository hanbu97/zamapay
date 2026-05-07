'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCardIcon, LockKeyholeIcon } from 'lucide-react'
import { createPublicClient, createWalletClient, custom, getAddress, parseEventLogs } from 'viem'
import { sepolia } from 'viem/chains'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { confidentialInvoiceSettlementAbi, confidentialUsdMockAbi } from '@/lib/contracts'
import { encryptPaymentAmount, publicDecryptPaymentCheck } from '@/lib/fhevm'
import { ensureEthereumProvider, ensureWalletChain, sepoliaWalletChain } from '@/lib/wallet'

type HexAddress = `0x${string}`

type CheckoutPaymentCardProps = {
  amountLabel: string
  amountMinorUnits: number
  chainInvoiceId: number | null
  finalityConfirmations: number
  finalityStatus: string
  finalityThreshold: number
  manifestChainId: number | null
  paymentTruth: string
  settlementAddress: string | null
  tokenAddress: string | null
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

function parseProjectionError(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : text
  } catch {
    return text
  }
}

async function projectFinalizedPayment(paymentTxHash: HexAddress) {
  const response = await fetch('/api/checkout/project-finalized-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentTxHash }),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(parseProjectionError(text) || `Payment projection failed with ${response.status}.`)
  }
}

export function CheckoutPaymentCard({
  amountLabel,
  amountMinorUnits,
  chainInvoiceId,
  finalityConfirmations,
  finalityStatus,
  finalityThreshold,
  manifestChainId,
  paymentTruth,
  settlementAddress,
  tokenAddress,
}: CheckoutPaymentCardProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [finalizeHash, setFinalizeHash] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [paymentHash, setPaymentHash] = useState<string | null>(null)
  const [status, setStatus] = useState('Connect a buyer wallet to submit the encrypted payment.')

  const isSepoliaManifest = manifestChainId === sepolia.id
  const isPayable = paymentTruth === 'pending_payment' && chainInvoiceId !== null
  const canPay = isPayable && isSepoliaManifest && Boolean(settlementAddress) && Boolean(tokenAddress)

  async function handlePayment() {
    setIsBusy(true)
    setError(null)
    setFinalizeHash(null)
    setPaymentHash(null)

    try {
      if (!canPay || chainInvoiceId === null) {
        throw new Error('This checkout needs a Sepolia contract manifest before browser payment is enabled.')
      }

      if (amountMinorUnits <= 0) {
        throw new Error('Invoice amount must be greater than zero.')
      }

      const amount = BigInt(amountMinorUnits)
      const provider = ensureEthereumProvider()
      const settlement = ensureHexAddress(settlementAddress, 'ConfidentialInvoiceSettlement')
      const token = ensureHexAddress(tokenAddress, 'ConfidentialUSDMock')

      setStatus('Switching wallet to Zama Sepolia...')
      await ensureWalletChain(provider, sepoliaWalletChain)

      const walletClient = createWalletClient({ chain: sepolia, transport: custom(provider) })
      const publicClient = createPublicClient({ chain: sepolia, transport: custom(provider) })
      const [selectedAddress] = await walletClient.requestAddresses()
      const payerAddress = getAddress(selectedAddress)

      setStatus('Approving encrypted mcUSD allowance...')
      const encryptedApproval = await encryptPaymentAmount({
        amountMinorUnits: amount,
        contractAddress: token,
        payerAddress,
        provider,
      })
      const approveHash = await walletClient.writeContract({
        address: token,
        abi: confidentialUsdMockAbi,
        functionName: 'approve',
        args: [settlement, encryptedApproval.handle, encryptedApproval.inputProof],
        account: payerAddress,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })

      setStatus('Encrypting settlement amount with the Zama relayer...')
      const encrypted = await encryptPaymentAmount({
        amountMinorUnits: amount,
        contractAddress: settlement,
        payerAddress,
        provider,
      })

      setStatus('Submitting ConfidentialInvoiceSettlement.payInvoice...')
      const hash = await walletClient.writeContract({
        address: settlement,
        abi: confidentialInvoiceSettlementAbi,
        functionName: 'payInvoice',
        args: [BigInt(chainInvoiceId), encrypted.handle, encrypted.inputProof],
        account: payerAddress,
      })
      setPaymentHash(hash)

      setStatus('Waiting for encrypted payment submission...')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const submittedLogs = parseEventLogs({
        abi: confidentialInvoiceSettlementAbi,
        eventName: 'InvoicePaymentSubmitted',
        logs: receipt.logs,
      })
      const paymentCheckHandle = submittedLogs[0]?.args.paymentCheckHandle as HexAddress | undefined

      if (!paymentCheckHandle) {
        throw new Error('Payment transaction confirmed without InvoicePaymentSubmitted event.')
      }

      setStatus('Publicly decrypting the payment validity proof...')
      const proof = await publicDecryptPaymentCheck(provider, paymentCheckHandle)

      if (!proof.accepted) {
        throw new Error('Encrypted payment was rejected by the settlement proof.')
      }

      setStatus('Finalizing verified payment on chain...')
      const finalizeHash = await walletClient.writeContract({
        address: settlement,
        abi: confidentialInvoiceSettlementAbi,
        functionName: 'finalizePayment',
        args: [BigInt(chainInvoiceId), proof.abiEncodedClearValues, proof.decryptionProof],
        account: payerAddress,
      })
      setFinalizeHash(finalizeHash)
      const finalizeReceipt = await publicClient.waitForTransactionReceipt({ hash: finalizeHash })
      const paidLogs = parseEventLogs({
        abi: confidentialInvoiceSettlementAbi,
        eventName: 'InvoicePaid',
        logs: finalizeReceipt.logs,
      })

      if (paidLogs.length === 0) {
        throw new Error('Payment finalization confirmed without InvoicePaid event.')
      }

      setStatus('Payment confirmed on chain. Projecting backend read model...')
      await projectFinalizedPayment(finalizeHash)

      setStatus('Payment projected. Refreshing fulfillment state...')
      router.refresh()
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Encrypted payment did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant={canPay ? 'default' : 'secondary'}>
            <LockKeyholeIcon data-icon="inline-start" />
            {canPay ? 'Sepolia encrypted payment ready' : 'Awaiting Sepolia manifest'}
          </Badge>
        </CardAction>
        <CardTitle>Confidential payment</CardTitle>
        <CardDescription>Encrypt the amount and settle this invoice on Zama Sepolia.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableBody>
            <PaymentRow label="Amount" value={amountLabel} />
            <PaymentRow label="Chain invoice" value={chainInvoiceId === null ? 'not projected' : `#${chainInvoiceId}`} />
            <PaymentStatusRow label="Payment" value={paymentTruth} />
            <PaymentStatusRow label="Finality" value={finalityStatus} />
            <PaymentRow label="Finality depth" value={formatFinalityDepth(finalityConfirmations, finalityThreshold)} />
          </TableBody>
        </Table>

        <Alert>
          <AlertTitle>Payment status</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>

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

        {!isSepoliaManifest ? (
          <Alert>
            <AlertTitle>Browser payment locked</AlertTitle>
            <AlertDescription>
              Browser relayer payment needs a Zama Sepolia manifest and funded confidential token balance.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!canPay || isBusy} onClick={handlePayment} type="button">
          {isBusy ? <Spinner data-icon="inline-start" /> : <CreditCardIcon data-icon="inline-start" />}
          {isBusy ? 'Processing encrypted payment...' : canPay ? 'Pay confidentially' : 'Sepolia manifest required'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function formatFinalityDepth(confirmations: number, threshold: number) {
  return threshold > 0 ? `${confirmations} / ${threshold}` : `${confirmations} / pending threshold`
}

function PaymentRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="max-w-[280px] truncate text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}

function PaymentStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right">
        <StatusBadge value={value} />
      </TableCell>
    </TableRow>
  )
}
