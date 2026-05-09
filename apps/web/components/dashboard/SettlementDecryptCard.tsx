'use client'

import { useMemo, useState } from 'react'
import { EyeIcon, LockKeyholeIcon } from 'lucide-react'
import { createPublicClient, createWalletClient, custom, getAddress, type Hex } from 'viem'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import type { InvoiceRecord } from '@/lib/api'
import { confidentialInvoiceSettlementAbi } from '@/lib/contracts'
import { contractEnvironmentForChainId, sepoliaContractEnvironment } from '@/lib/contract-environment'
import { userDecryptSettlementAmount } from '@/lib/fhevm'
import { ensureEthereumProvider, ensureWalletChain } from '@/lib/wallet'

type SettlementDecryptCardProps = {
  invoices: InvoiceRecord[]
  manifestChainId: number | null
  settlementAddress: string | null
}

type HexAddress = `0x${string}`

function ensureHexAddress(address: string | null, label: string): HexAddress {
  if (!address?.startsWith('0x')) {
    throw new Error(`${label} is not deployed in the contract manifest.`)
  }

  return address as HexAddress
}

function readableError(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Settlement decrypt failed.'
}

export function SettlementDecryptCard({
  invoices,
  manifestChainId,
  settlementAddress,
}: SettlementDecryptCardProps) {
  const decryptableInvoices = useMemo(
    () =>
      invoices.filter(
        (invoice) => invoice.snapshot.paymentTruth === 'paid' && invoice.chainInvoiceId !== null,
      ),
    [invoices],
  )
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(decryptableInvoices[0]?.invoiceId ?? '')
  const [decryptedMinorUnits, setDecryptedMinorUnits] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState('Merchant wallet authorization is required before plaintext appears.')

  const selectedInvoice = decryptableInvoices.find((invoice) => invoice.invoiceId === selectedInvoiceId) ?? null
  const canDecrypt = contractEnvironmentForChainId(manifestChainId) === 'sepolia' && Boolean(settlementAddress) && selectedInvoice !== null

  async function handleDecrypt() {
    setError(null)
    setDecryptedMinorUnits(null)
    setIsBusy(true)

    try {
      if (!selectedInvoice?.chainInvoiceId || !canDecrypt) {
        throw new Error('Select a paid Sepolia invoice before requesting merchant decrypt.')
      }

      const provider = ensureEthereumProvider()
      const settlement = ensureHexAddress(settlementAddress, 'ConfidentialInvoiceSettlement')
      const decryptEnvironment = sepoliaContractEnvironment

      setStatus('Switching wallet to Zama Sepolia...')
      await ensureWalletChain(provider, decryptEnvironment.walletChain)

      const walletClient = createWalletClient({ chain: decryptEnvironment.chain, transport: custom(provider) })
      const publicClient = createPublicClient({ chain: decryptEnvironment.chain, transport: custom(provider) })
      const [selectedAddress] = await walletClient.requestAddresses()
      const merchantAddress = getAddress(selectedAddress)

      setStatus('Reading encrypted settlement handle...')
      const handle = await publicClient.readContract({
        address: settlement,
        abi: confidentialInvoiceSettlementAbi,
        functionName: 'settledAmountHandleOf',
        args: [BigInt(selectedInvoice.chainInvoiceId)],
      })

      setStatus('Requesting wallet-authorized user decrypt...')
      const amount = await userDecryptSettlementAmount({
        contractAddress: settlement,
        handle: handle as Hex,
        provider,
        signTypedData: (payload) =>
          walletClient.signTypedData({
            account: merchantAddress,
            domain: payload.domain,
            message: payload.message,
            primaryType: 'UserDecryptRequestVerification',
            types: payload.types,
          }),
        userAddress: merchantAddress,
      })

      setDecryptedMinorUnits(amount)
      setStatus('Settlement summary decrypted by merchant wallet authorization.')
    } catch (caught) {
      setError(readableError(caught))
      setStatus('Settlement decrypt did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card className="max-w-2xl" size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant={canDecrypt ? 'default' : 'secondary'}>
            <LockKeyholeIcon data-icon="inline-start" />
            {canDecrypt ? 'Sepolia decrypt ready' : 'Sepolia required'}
          </Badge>
        </CardAction>
        <CardTitle>Confidential settlement summary</CardTitle>
        <CardDescription>Plaintext revenue is requested through wallet-authorized Zama user decrypt.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select onValueChange={(value) => setSelectedInvoiceId(value ?? '')} value={selectedInvoiceId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select paid invoice" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {decryptableInvoices.map((invoice) => (
                <SelectItem key={invoice.invoiceId} value={invoice.invoiceId}>
                  {invoice.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Table>
          <TableBody>
            <SummaryRow label="Invoice" value={selectedInvoice?.invoiceId ?? 'no paid invoice'} />
            <SummaryRow label="Expected display amount" value={selectedInvoice?.amountLabel ?? 'not available'} />
            <SummaryStatusRow label="Decrypt job" value={selectedInvoice?.snapshot.decryptJobStatus ?? 'idle'} />
            <SummaryRow label="Decrypted minor units" value={decryptedMinorUnits?.toString() ?? 'locked'} />
          </TableBody>
        </Table>

        <Alert>
          <AlertTitle>Decrypt status</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Decrypt failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {contractEnvironmentForChainId(manifestChainId) !== 'sepolia' ? (
          <Alert>
            <AlertTitle>Sepolia relayer required</AlertTitle>
            <AlertDescription>
              Local ACL behavior is locked by contract tests. Browser user decrypt runs against the Sepolia relayer.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={!canDecrypt || isBusy} onClick={handleDecrypt} type="button">
          {isBusy ? <Spinner data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
          {isBusy ? 'Decrypting settlement...' : 'Request merchant decrypt'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="max-w-[280px] truncate text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}

function SummaryStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right">
        <StatusBadge value={value} />
      </TableCell>
    </TableRow>
  )
}
