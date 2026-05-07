import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ArrowRightIcon, BellRingIcon, ReceiptTextIcon } from 'lucide-react'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getSession, type ProjectDashboardOverview } from '@/lib/api'
import { loadMerchantProjectOverview, loadMerchantProjects } from '@/lib/merchant-portal'

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
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
        description="Payments need the Rust merchant project endpoints before checkout and webhook state can be shown."
        reason={projectsResult.reason}
        retryHref="/dashboard"
        title="Payments"
      />
    )
  }

  const projects = projectsResult.data
  const params = searchParams ? await searchParams : {}
  const requestedProjectId = typeof params.projectId === 'string' ? params.projectId : null
  const selectedProject = projects.find((project) => project.projectId === requestedProjectId) ?? projects[0] ?? null
  const overviewResult = selectedProject
    ? await loadMerchantProjectOverview(selectedProject.projectId, cookieHeader)
    : ({ data: null, status: 'ready' } as const)
  if (overviewResult.status === 'unauthorized') {
    redirect('/login?next=/dashboard')
  }
  if (overviewResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Payments need the selected project overview before checkout and webhook state can be shown."
        reason={overviewResult.reason}
        retryHref="/dashboard"
        title="Payments"
      />
    )
  }

  const overview = overviewResult.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          <Button nativeButton={false} render={<Link href="/merchant" />} size="lg">
            Project settings
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        }
        badge={selectedProject ? selectedProject.defaultEnvironment.replace('_', ' ') : 'No project'}
        description="Project-scoped payments, finality state, webhook delivery health, and buyer checkout links."
        title="Payments"
      />

      {overview ? <PaymentsDashboard overview={overview} /> : <NoProjectState />}
    </div>
  )
}

function PaymentsDashboard({ overview }: { overview: ProjectDashboardOverview }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total checkouts" value={overview.summary.totalCheckouts} />
        <MetricCard label="Open" value={overview.summary.openCheckouts} />
        <MetricCard label="Paid" value={overview.summary.paidCheckouts} />
        <MetricCard label="Webhook backlog" value={overview.summary.pendingDeliveries} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant="secondary">{overview.checkoutSessions.length}</Badge>
            </CardAction>
            <CardTitle>Checkout sessions</CardTitle>
            <CardDescription>Buyer-facing hosted checkout sessions created through project API-key auth.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Checkout</TableHead>
                  <TableHead className="w-28">Amount</TableHead>
                  <TableHead className="hidden w-32 md:table-cell">Chain invoice</TableHead>
                  <TableHead className="w-24 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.checkoutSessions.length > 0 ? (
                  overview.checkoutSessions.map((session) => (
                    <TableRow key={session.checkoutSessionId}>
                      <TableCell>
                        <div className="flex max-w-[360px] flex-col gap-1">
                          <Link className="truncate font-medium hover:underline" href={`/checkout/${session.invoiceId}`}>
                            {session.title}
                          </Link>
                          <span className="truncate font-mono text-xs text-muted-foreground">{session.merchantOrderId}</span>
                        </div>
                      </TableCell>
                      <TableCell>{session.amountLabel}</TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">{session.chainInvoiceId}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge value={session.status} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Empty className="border">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <ReceiptTextIcon />
                          </EmptyMedia>
                          <EmptyTitle>No checkouts yet</EmptyTitle>
                          <EmptyDescription>Connect a merchant backend with the project API key to create buyer payment links.</EmptyDescription>
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
              <Badge variant={overview.summary.failedWebhooks > 0 ? 'destructive' : 'outline'}>
                {overview.summary.failedWebhooks > 0 ? 'Dead letter' : 'Healthy'}
              </Badge>
            </CardAction>
            <CardTitle>Webhook health</CardTitle>
            <CardDescription>Delivery attempts are project-level outbox records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <SummaryRow label="Endpoints" value={overview.webhookEndpoints.length} />
                <SummaryRow label="Events" value={overview.webhookEvents.length} />
                <SummaryRow label="Pending" value={overview.summary.pendingDeliveries} />
                <SummaryRow label="Delivered" value={overview.summary.deliveredWebhooks} />
                <SummaryRow label="Dead letter" value={overview.summary.failedWebhooks} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardAction>
            <BellRingIcon />
          </CardAction>
          <CardTitle>Recent deliveries</CardTitle>
          <CardDescription>HTTP status, retry state, and signature presence for webhook diagnostics.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">HTTP</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.webhookDeliveries.map((delivery) => (
                <TableRow key={delivery.deliveryId}>
                  <TableCell className="font-mono text-xs">{delivery.deliveryId}</TableCell>
                  <TableCell>
                    <StatusBadge value={delivery.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{delivery.httpStatus ?? delivery.error ?? 'pending'}</TableCell>
                  <TableCell className="text-right">{delivery.attemptCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function NoProjectState() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ReceiptTextIcon />
        </EmptyMedia>
        <EmptyTitle>No payment project</EmptyTitle>
        <EmptyDescription>Create a merchant project before inspecting payments.</EmptyDescription>
      </EmptyHeader>
      <Button nativeButton={false} render={<Link href="/merchant" />}>
        Create project
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </Empty>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{value}</CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}
