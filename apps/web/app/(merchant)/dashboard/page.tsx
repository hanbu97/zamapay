import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ReceiptTextIcon } from 'lucide-react'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getSession, type PaymentProject, type ProjectDashboardOverview } from '@/lib/api'
import { loadMerchantProjectOverview, loadMerchantProjects } from '@/lib/merchant-portal'

type AccountSnapshot = {
  overview: ProjectDashboardOverview | null
  project: PaymentProject
}

export default async function DashboardPage() {
  const cookieHeader = (await cookies()).toString()
  const session = await getSession(cookieHeader)

  if (!session.authenticated || !session.user) {
    redirect('/login?next=/dashboard')
  }

  const projectsResult = await loadMerchantProjects(cookieHeader)
  if (projectsResult.status === 'unauthorized') {
    redirect('/login?next=/dashboard')
  }
  if (projectsResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Account overview needs the Rust merchant project endpoints before checkout and webhook state can be shown."
        reason={projectsResult.reason}
        retryHref="/dashboard"
        title="Overview"
      />
    )
  }

  const overviewResults = await Promise.all(
    projectsResult.data.map((project) => loadMerchantProjectOverview(project.projectId, cookieHeader)),
  )
  for (const overviewResult of overviewResults) {
    if (overviewResult.status === 'unauthorized') {
      redirect('/login?next=/dashboard')
    }
    if (overviewResult.status === 'unavailable') {
      return (
        <MerchantPortalUnavailable
          description="Account overview needs project read models before aggregate payments can be shown."
          reason={overviewResult.reason}
          retryHref="/dashboard"
          title="Overview"
        />
      )
    }
  }

  const snapshots: AccountSnapshot[] = projectsResult.data.map((project, index) => {
    const result = overviewResults[index]

    return {
      overview: result.status === 'ready' ? result.data : null,
      project,
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        badge="Account"
        description="All-project checkout volume, platform fees, webhook health, and payment activity."
        title="Overview"
      />

      <AccountDashboard snapshots={snapshots} />
    </div>
  )
}

function AccountDashboard({ snapshots }: { snapshots: AccountSnapshot[] }) {
  const summary = summarizeAccount(snapshots)
  const sessions = snapshots.flatMap(({ overview, project }) =>
    (overview?.checkoutSessions ?? []).map((session) => ({
      project,
      session,
    })),
  )
  const todaySessions = sessions.filter(({ session }) => isToday(session.createdAt))
  const todayVolumeMinorUnits = todaySessions.reduce(
    (volume, { session }) => (session.status === 'paid' ? volume + session.amountMinorUnits : volume),
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Projects" value={summary.projectCount} />
        <MetricCard description="Available to withdraw" label="Total Balance" value={formatMinorUnits(summary.withdrawableMinorUnits)} />
        <MetricCard description="Checkout sessions created today" label="Today's Orders" value={todaySessions.length} />
        <MetricCard description="Paid gross volume today" label="Today's Volume" value={formatMinorUnits(todayVolumeMinorUnits)} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant="secondary">{sessions.length}</Badge>
            </CardAction>
            <CardTitle>Recent checkout sessions</CardTitle>
            <CardDescription>Buyer-facing hosted checkout sessions across every payment project.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Checkout</TableHead>
                  <TableHead className="hidden md:table-cell">Project</TableHead>
                  <TableHead className="w-28">Amount</TableHead>
                  <TableHead className="hidden w-28 md:table-cell">Fee</TableHead>
                  <TableHead className="w-24 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.length > 0 ? (
                  sessions.map(({ project, session }) => (
                    <TableRow key={session.checkoutSessionId}>
                      <TableCell>
                        <div className="flex max-w-[360px] flex-col gap-1">
                          <Link className="truncate font-medium hover:underline" href={`/checkout/${session.invoiceId}`}>
                            {session.title}
                          </Link>
                          <span className="truncate font-mono text-xs text-muted-foreground">{session.merchantOrderId}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Link className="hover:underline" href={`/merchant/${project.projectId}?tab=payments`}>
                          {project.name}
                        </Link>
                      </TableCell>
                      <TableCell>{session.amountLabel}</TableCell>
                      <TableCell className="hidden md:table-cell">{formatCheckoutFee(session)}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge value={session.status} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Empty className="border">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <ReceiptTextIcon />
                          </EmptyMedia>
                          <EmptyTitle>No checkouts yet</EmptyTitle>
                          <EmptyDescription>Open a project, copy its API key, and create a checkout from a merchant backend.</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant={summary.failedWebhooks > 0 ? 'destructive' : 'outline'}>
                {summary.failedWebhooks > 0 ? 'Dead letter' : 'Healthy'}
              </Badge>
            </CardAction>
            <CardTitle>Webhook health</CardTitle>
            <CardDescription>Delivery attempts aggregated across all project outboxes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <SummaryRow label="Projects" value={summary.projectCount} />
                <SummaryRow label="Endpoints" value={summary.webhookEndpoints} />
                <SummaryRow label="Events" value={summary.webhookEvents} />
                <SummaryRow label="Pending" value={summary.pendingDeliveries} />
                <SummaryRow label="Delivered" value={summary.deliveredWebhooks} />
                <SummaryRow label="Dead letter" value={summary.failedWebhooks} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricCard({ description, label, value }: { description?: string; label: string; value: number | string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{value}</CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      {description ? <CardContent className="pt-0 text-sm text-muted-foreground">{description}</CardContent> : null}
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: number | string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}

function summarizeAccount(snapshots: AccountSnapshot[]) {
  return snapshots.reduce(
    (summary, snapshot) => {
      const overview = snapshot.overview
      summary.projectCount += 1
      summary.totalCheckouts += overview?.summary.totalCheckouts ?? 0
      summary.grossVolumeMinorUnits += overview?.summary.grossVolumeMinorUnits ?? 0
      summary.platformFeeMinorUnits += overview?.summary.platformFeeMinorUnits ?? 0
      summary.merchantNetMinorUnits += overview?.summary.merchantNetMinorUnits ?? 0
      summary.withdrawableMinorUnits += overview?.summary.withdrawableMinorUnits ?? 0
      summary.pendingDeliveries += overview?.summary.pendingDeliveries ?? 0
      summary.deliveredWebhooks += overview?.summary.deliveredWebhooks ?? 0
      summary.failedWebhooks += overview?.summary.failedWebhooks ?? 0
      summary.webhookEndpoints += overview?.webhookEndpoints.length ?? 0
      summary.webhookEvents += overview?.webhookEvents.length ?? 0

      return summary
    },
    {
      deliveredWebhooks: 0,
      failedWebhooks: 0,
      grossVolumeMinorUnits: 0,
      merchantNetMinorUnits: 0,
      pendingDeliveries: 0,
      platformFeeMinorUnits: 0,
      projectCount: 0,
      totalCheckouts: 0,
      withdrawableMinorUnits: 0,
      webhookEndpoints: 0,
      webhookEvents: 0,
    },
  )
}

function isToday(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return false
  }

  const today = new Date()

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

function formatMinorUnits(value: number) {
  return `${(value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} cUSDT`
}

function formatCheckoutFee(session: ProjectDashboardOverview['checkoutSessions'][number]) {
  const fee = session.billing?.platformFeeMinorUnits

  return typeof fee === 'number' ? formatMinorUnits(fee) : 'not quoted'
}
