import Link from 'next/link'
import {
  ArrowRightIcon,
  HistoryIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BillingPaymentRecord, BillingPlan, BillingSubscriptionResponse } from '@/lib/api'

type MerchantBillingOverviewProps = {
  billing: BillingSubscriptionResponse
}

export function MerchantBillingOverview({ billing }: MerchantBillingOverviewProps) {
  const { subscription } = billing
  const catalog = billing.plans.find((plan) => plan.plan === subscription.plan)
  const payments = billing.payments ?? []

  return (
    <div className="mermer-flow-stack flex flex-col">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">
            Account subscription, fee entitlement, and previous subscription payments.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/billing/upgrade" />}>
          Upgrade plan
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Current subscription</CardTitle>
            <CardDescription>Controls the fee snapshot used by new checkout sessions.</CardDescription>
            <CardAction>
              <Badge variant="secondary">
                <ShieldCheckIcon />
                {formatPlan(subscription.plan)}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Checkout fee" value={formatBps(catalog?.checkoutFeeBps)} />
              <Metric label="Billing cycle" value={formatLabel(subscription.billingCycle)} />
              <Metric label="Status" value={formatLabel(subscription.status)} />
              <Metric label="Entitlement" value={formatLabel(subscription.entitlementStatus)} />
              <Metric label="Current period" value={formatPeriod(subscription.currentPeriodStartedAt, subscription.currentPeriodEndsAt)} />
              <Metric label="Subscription pass" value={subscription.passId ?? 'Not issued'} />
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Subscription payment history</CardTitle>
          <CardDescription>Previous payments recorded by the merchant billing backend.</CardDescription>
          <CardAction>
            <Badge variant="outline">
              <HistoryIcon />
              {payments.length} records
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {payments.length ? <PaymentHistoryTable payments={payments} /> : <PaymentHistoryEmpty />}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-3">
      <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  )
}

function PaymentHistoryTable({ payments }: { payments: BillingPaymentRecord[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[20%]">Date</TableHead>
          <TableHead className="w-[18%]">Plan</TableHead>
          <TableHead className="w-[18%]">Amount</TableHead>
          <TableHead className="w-[16%]">Status</TableHead>
          <TableHead>Proof</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.paymentId}>
            <TableCell className="whitespace-normal text-muted-foreground">{formatDate(payment.createdAt)}</TableCell>
            <TableCell>
              <div className="flex flex-col gap-1">
                <span className="font-medium">{formatPlan(payment.plan)}</span>
                <span className="text-xs text-muted-foreground">{formatLabel(payment.billingCycle)}</span>
              </div>
            </TableCell>
            <TableCell>{formatMinorUnits(payment.amountMinorUnits, payment.currency)}</TableCell>
            <TableCell>
              <Badge variant="secondary">{formatLabel(payment.status)}</Badge>
            </TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">
              {payment.chainTxHash ? compactHash(payment.chainTxHash) : 'Local-dev record'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PaymentHistoryEmpty() {
  return (
    <Empty className="border">
      <EmptyMedia variant="icon">
        <ReceiptTextIcon />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>No subscription payments yet</EmptyTitle>
        <EmptyDescription>Plan changes will appear here after the first subscription payment settles.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function formatPlan(plan: BillingPlan) {
  return plan === 'free' ? 'Free' : plan === 'growth' ? 'Growth' : 'Enterprise'
}

function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Contract required'
  }

  return `${(value / 100).toFixed(2)}%`
}

function formatLabel(value: string) {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatPeriod(start: string, end: string) {
  return `${formatDate(start)} - ${formatDate(end)}`
}

function formatMinorUnits(value: number, currency: string) {
  return `${(value / 1_000000).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`
}

function compactHash(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value
}
