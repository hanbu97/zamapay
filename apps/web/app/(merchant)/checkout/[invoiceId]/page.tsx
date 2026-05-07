import { notFound } from 'next/navigation'
import { ReceiptTextIcon } from 'lucide-react'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { CheckoutPaymentCard } from '@/components/checkout/CheckoutPaymentCard'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { getContractManifest, getInvoiceRecord } from '@/lib/api'

type CheckoutPageProps = {
  params: Promise<{ invoiceId: string }>
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { invoiceId } = await params
  const [invoice, manifest] = await Promise.all([
    getInvoiceRecord(invoiceId),
    getContractManifest(),
  ])

  if (!invoice) {
    notFound()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Hosted checkout"
        description="Buyer-facing hosted payment page issued by the merchant payment project."
        title={invoice.title}
      />

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant="secondary">
                <ReceiptTextIcon data-icon="inline-start" />
                {invoice.amountLabel}
              </Badge>
            </CardAction>
            <CardTitle>Order summary</CardTitle>
            <CardDescription>Merchant order data attached to this hosted checkout.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableBody>
                <DetailRow label="Merchant" value={invoice.merchantName} />
                <DetailRow label="Invoice ID" value={invoice.invoiceId} />
                <DetailRow
                  label="Chain invoice"
                  value={invoice.chainInvoiceId === null ? 'not projected' : `#${invoice.chainInvoiceId}`}
                />
                <StatusRow label="Payment" value={invoice.snapshot.paymentTruth} />
                <StatusRow label="Finality" value={invoice.snapshot.finalityStatus} />
                <DetailRow
                  label="Finality depth"
                  value={formatFinalityDepth(invoice.finalityConfirmations, invoice.finalityThreshold)}
                />
              </TableBody>
            </Table>

            <Separator />

            <Table>
              <TableBody>
                <StatusRow label="Release gate" value={invoice.snapshot.fulfillmentStatus} />
                <StatusRow label="Webhook" value={invoice.webhook?.status ?? 'idle'} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <CheckoutPaymentCard
          amountLabel={invoice.amountLabel}
          amountMinorUnits={invoice.amountMinorUnits}
          chainInvoiceId={invoice.chainInvoiceId}
          finalityConfirmations={invoice.finalityConfirmations}
          finalityStatus={invoice.snapshot.finalityStatus}
          finalityThreshold={invoice.finalityThreshold}
          manifestChainId={manifest.chainId}
          paymentTruth={invoice.snapshot.paymentTruth}
          settlementAddress={manifest.contracts.ConfidentialInvoiceSettlement}
          tokenAddress={manifest.contracts.ConfidentialUSDMock}
        />
      </section>
    </div>
  )
}

function formatFinalityDepth(confirmations: number, threshold: number) {
  return threshold > 0 ? `${confirmations} / ${threshold}` : `${confirmations} / pending threshold`
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="max-w-[300px] truncate text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right">
        <StatusBadge value={value} />
      </TableCell>
    </TableRow>
  )
}
