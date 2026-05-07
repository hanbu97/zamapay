import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  GaugeIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getOptionalSession, type InvoiceRecord } from '@/lib/api'
import { getOperatorDiagnostics, type OperatorDiagnostics } from '@/lib/operator'

export default async function OpsPage() {
  const session = await getOptionalSession((await cookies()).toString())

  if (!session.authenticated || !session.user) {
    redirect('/login?next=/ops')
  }

  const result = await getOperatorDiagnostics()

  if (result.status !== 'ready') {
    return <OperatorUnavailable reason={result.reason} status={result.status} />
  }

  const diagnostics = result.diagnostics
  const indexerStalled = diagnostics.indexerStalled === true
  const latestChainInvoiceId = diagnostics.indexerCursor?.latestChainInvoiceId ?? null
  const pendingDecryptJobs = numeric(diagnostics.pendingDecryptJobs)
  const pendingFinalityBacklog = numeric(diagnostics.pendingFinalityBacklog)
  const pendingWebhooks = numeric(diagnostics.pendingWebhooks)
  const retryingWebhooks = numeric(diagnostics.retryingWebhooks)
  const failedWebhooks = numeric(diagnostics.failedWebhooks)
  const expiredInvoices = numeric(diagnostics.expiredInvoices)
  const operatorAuthRejections = numeric(diagnostics.operatorAuthRejections)
  const decryptPendingGuardTrips = numeric(diagnostics.decryptPendingGuardTrips)
  const decryptTimeouts = numeric(diagnostics.decryptTimeouts)
  const replayGuardFailures = numeric(diagnostics.replayGuardFailures)
  const reorgExceptions = numeric(diagnostics.reorgExceptions)
  const frozenFulfillments = numeric(diagnostics.frozenFulfillments)
  const releaseFailures = numeric(diagnostics.releaseFailures)
  const incidentTotal = countIncidents(diagnostics)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge={diagnostics.operatorActionRequired ? 'Intervention required' : 'Operator healthy'}
        description="Show only the queues and incidents that change operator action."
        title="Operator diagnostics"
      />

      {diagnostics.operatorActionRequired ? (
        <Alert variant="destructive">
          <ShieldAlertIcon data-icon="inline-start" />
          <AlertTitle>Manual action required</AlertTitle>
          <AlertDescription>One or more incident counters need review before the rail is safe for merchant traffic.</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <GaugeIcon data-icon="inline-start" />
          <AlertTitle>Rail healthy</AlertTitle>
          <AlertDescription>No reorg, decrypt, webhook, or fulfillment incidents in the current read model.</AlertDescription>
        </Alert>
      )}

      <section className="grid items-start gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <OperatorSummaryCard
          latestChainInvoiceId={latestChainInvoiceId}
          rows={[
            { label: 'Chain sync', value: diagnostics.chainSyncStatus },
            { label: 'Indexed invoices', value: numeric(diagnostics.indexerCursor?.indexedInvoices) },
            { label: 'Finality backlog', value: pendingFinalityBacklog },
            { label: 'Decrypt jobs', value: pendingDecryptJobs },
            { label: 'Pending webhooks', value: pendingWebhooks },
            { label: 'Retrying webhooks', value: retryingWebhooks },
            { label: 'Failed webhooks', tone: 'danger', value: failedWebhooks },
          ]}
        />
        <IncidentCard
          incidentTotal={incidentTotal}
          rows={[
            { label: 'Reorg exceptions', value: reorgExceptions },
            { label: 'Indexer stalled', tone: 'danger', value: indexerStalled ? 1 : 0 },
            { label: 'Operator auth rejections', tone: 'danger', value: operatorAuthRejections },
            { label: 'Expired invoices', tone: 'danger', value: expiredInvoices },
            { label: 'Decrypt pending guard trips', value: decryptPendingGuardTrips },
            { label: 'Decrypt timeouts', tone: 'danger', value: decryptTimeouts },
            { label: 'Replay guard failures', tone: 'danger', value: replayGuardFailures },
            { label: 'Frozen fulfillments', value: frozenFulfillments },
            { label: 'Release failures', value: releaseFailures },
          ]}
        />
      </section>

      {diagnostics.invoices.length > 0 ? <InvoiceDiagnosticsTable invoices={diagnostics.invoices} /> : null}
    </div>
  )
}

function OperatorUnavailable({ reason, status }: { reason: string; status: 'error' | 'locked' }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge={status === 'locked' ? 'Operator locked' : 'Operator unavailable'}
        description="Diagnostics require the server-side operator boundary."
        title="Operator diagnostics"
      />
      <Alert variant={status === 'locked' ? 'default' : 'destructive'}>
        <LockKeyholeIcon data-icon="inline-start" />
        <AlertTitle>{status === 'locked' ? 'Operator key required' : 'Diagnostics unavailable'}</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
    </div>
  )
}

type OpsRow = {
  label: string
  tone?: 'danger'
  value: number | string
}

function OperatorSummaryCard({
  latestChainInvoiceId,
  rows,
}: {
  latestChainInvoiceId: number | null
  rows: OpsRow[]
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">
            {latestChainInvoiceId === null ? 'No cursor' : `#${latestChainInvoiceId}`}
          </Badge>
        </CardAction>
        <CardTitle>Operational queues</CardTitle>
        <CardDescription>Cursor, finality, decrypt, and webhook state.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          {rows.map((row) => (
            <OpsRowView key={row.label} {...row} />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

function IncidentCard({ incidentTotal, rows }: { incidentTotal: number; rows: OpsRow[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant={incidentTotal > 0 ? 'destructive' : 'secondary'}>{incidentTotal}</Badge>
        </CardAction>
        <CardTitle>Intervention queue</CardTitle>
        <CardDescription>Non-zero rows are the operator action list.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
            {rows.map((row) => (
              <OpsRowView key={row.label} {...row} />
            ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

function OpsRowView({ label, tone, value }: OpsRow) {
  const numericValue = typeof value === 'number' ? value : 0

  return (
    <Item size="sm" variant="outline">
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
      </ItemContent>
      <ItemActions>
        {typeof value === 'number' ? (
          <Badge variant={tone === 'danger' && numericValue > 0 ? 'destructive' : 'secondary'}>{value}</Badge>
        ) : (
          <span className="max-w-[160px] truncate text-right font-medium">{value}</span>
        )}
      </ItemActions>
    </Item>
  )
}

function InvoiceDiagnosticsTable({ invoices }: { invoices: InvoiceRecord[] }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">
            <ReceiptTextIcon data-icon="inline-start" />
            {invoices.length}
          </Badge>
        </CardAction>
        <CardTitle>Invoice state</CardTitle>
        <CardDescription>Payment, finality, decrypt, webhook, and fulfillment state per invoice.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead className="hidden md:table-cell">Payment</TableHead>
              <TableHead className="hidden md:table-cell">Finality</TableHead>
              <TableHead className="hidden lg:table-cell">Decrypt</TableHead>
              <TableHead className="hidden xl:table-cell">Webhook</TableHead>
              <TableHead className="text-right">Fulfillment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.invoiceId}>
                <TableCell>
                  <div className="flex max-w-[240px] flex-col gap-1">
                    <span className="truncate font-medium">{invoice.title}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{invoice.invoiceId}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <StatusBadge value={invoice.snapshot.paymentTruth} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge value={invoice.snapshot.finalityStatus} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatFinalityDepth(invoice.finalityConfirmations, invoice.finalityThreshold)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <StatusBadge value={invoice.snapshot.decryptJobStatus} />
                </TableCell>
                <TableCell className="hidden xl:table-cell">
                  <StatusBadge value={invoice.webhook?.status ?? 'idle'} />
                </TableCell>
                <TableCell className="text-right">
                  <StatusBadge value={invoice.snapshot.fulfillmentStatus} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function formatFinalityDepth(confirmations: number | undefined, threshold: number | undefined): string {
  const safeConfirmations = numeric(confirmations)
  const safeThreshold = numeric(threshold)
  return safeThreshold > 0 ? `${safeConfirmations}/${safeThreshold}` : `${safeConfirmations}/-`
}

function countIncidents(diagnostics: OperatorDiagnostics): number {
  return (
    numeric(diagnostics.failedWebhooks) +
    (diagnostics.indexerStalled ? 1 : 0) +
    numeric(diagnostics.expiredInvoices) +
    numeric(diagnostics.operatorAuthRejections) +
    numeric(diagnostics.decryptTimeouts) +
    numeric(diagnostics.replayGuardFailures) +
    numeric(diagnostics.reorgExceptions) +
    numeric(diagnostics.frozenFulfillments) +
    numeric(diagnostics.releaseFailures)
  )
}

function numeric(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
