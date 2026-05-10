'use client'

import { useMemo } from 'react'
import { ArrowDownToLineIcon, ArrowUpRightIcon, CopyIcon, ExternalLinkIcon, LandmarkIcon } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ProjectDashboardOverview, ProjectEnvironmentKind } from '@/lib/api'
import { contractEnvironmentConfig } from '@/lib/contract-environment'
import { compact, formatMinorUnits, formatTime } from './PaymentProjectConsoleParts'

export type BalanceRangeKey = '24h' | '7d' | '30d' | 'all'

type BalanceActivity = {
  direction: 'inflow' | 'outflow'
  grossMinorUnits?: number
  id: string
  minorUnits: number
  occurredAt: string
  referenceHref: string | null
  referenceLabel: string
  referenceValue: string | null
  status: string
  subtitle: string
  title: string
}

type BalanceTrendPoint = {
  balance: number
  balanceMinorUnits: number
  fullLabel: string
  inflowMinorUnits: number
  netMinorUnits: number
  outflowMinorUnits: number
  timestamp: number
}

type BalanceTrend = {
  currentBalanceMinorUnits: number
  netChangeMinorUnits: number
  openingBalanceMinorUnits: number
  points: BalanceTrendPoint[]
  spanMs: number
}

const BALANCE_RANGE_OPTIONS: Array<{ label: string; value: BalanceRangeKey }> = [
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: 'All', value: 'all' },
]

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

export function BalanceTrendCard({
  activities,
  onRangeChange,
  range,
}: {
  activities: BalanceActivity[]
  onRangeChange: (value: BalanceRangeKey) => void
  range: BalanceRangeKey
}) {
  const trend = useMemo(() => buildBalanceTrend(activities, range), [activities, range])
  const hasActivity = activities.length > 0

  return (
    <Card className="min-h-72" size="sm">
      <CardHeader>
        <CardAction className="max-w-full">
          <div aria-label="Balance chart period" className="flex rounded-lg border bg-muted p-0.5">
            {BALANCE_RANGE_OPTIONS.map((option) => (
              <Button
                aria-pressed={range === option.value}
                className={`h-8 min-w-10 px-3 text-xs font-semibold transition-colors ${
                  range === option.value
                    ? 'bg-foreground text-background shadow-sm hover:bg-foreground/90 hover:text-background'
                    : 'text-muted-foreground hover:bg-background hover:text-foreground'
                }`}
                key={option.value}
                onClick={() => onRangeChange(option.value)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardAction>
        <CardTitle>Balance trend</CardTitle>
        <CardDescription>Available merchant balance after checkout inflows and withdraw outflows.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <BalanceTrendFact label="Current" value={formatMinorUnits(trend.currentBalanceMinorUnits)} />
          <BalanceTrendFact label="Period change" value={formatSignedMinorUnits(trend.netChangeMinorUnits)} />
          <BalanceTrendFact label="Opening" value={formatMinorUnits(trend.openingBalanceMinorUnits)} />
        </div>
        <div className="h-56 rounded-lg border bg-muted/20 p-2">
          {hasActivity ? (
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={trend.points} margin={{ bottom: 0, left: 0, right: 12, top: 8 }}>
                <defs>
                  <linearGradient id="merchant-balance-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="timestamp"
                  domain={['dataMin', 'dataMax']}
                  minTickGap={28}
                  scale="time"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value) => formatChartTick(Number(value), trend.spanMs)}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={formatAxisCusdt}
                  tickLine={false}
                  width={56}
                />
                <Tooltip content={<BalanceTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Area
                  dataKey="balance"
                  fill="url(#merchant-balance-fill)"
                  isAnimationActive={false}
                  stroke="var(--foreground)"
                  strokeWidth={2}
                  type="stepAfter"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty className="h-full border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LandmarkIcon />
                </EmptyMedia>
                <EmptyTitle>No balance movement</EmptyTitle>
                <EmptyDescription>Paid checkouts and withdrawals will build this trend.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function BalanceTrendFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl leading-tight font-semibold text-foreground">{value}</div>
    </div>
  )
}

function BalanceTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: BalanceTrendPoint }>
}) {
  const point = payload?.[0]?.payload

  if (!active || !point) {
    return null
  }

  return (
    <div className="min-w-44 rounded-lg border bg-background p-3 text-xs shadow-lg">
      <div className="font-medium">{point.fullLabel}</div>
      <div className="mt-2 flex justify-between gap-6">
        <span className="text-muted-foreground">Balance</span>
        <span className="font-medium">{formatMinorUnits(point.balanceMinorUnits)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-6">
        <span className="text-muted-foreground">Net</span>
        <span>{formatSignedMinorUnits(point.netMinorUnits)}</span>
      </div>
    </div>
  )
}

export function BalanceActivityCard({
  activities,
  onCopyReference,
}: {
  activities: BalanceActivity[]
  onCopyReference: (value: string) => void
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">{activities.length}</Badge>
        </CardAction>
        <CardTitle>Balance activity</CardTitle>
        <CardDescription>Merchant net inflows from paid checkouts and chain withdraw outflows.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Activity</TableHead>
              <TableHead>Delta</TableHead>
              <TableHead className="hidden md:table-cell">Reference</TableHead>
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.length > 0 ? (
              activities.map((activity) => (
                <BalanceActivityRow activity={activity} key={activity.id} onCopyReference={onCopyReference} />
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5}>
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <LandmarkIcon />
                      </EmptyMedia>
                      <EmptyTitle>No balance activity</EmptyTitle>
                      <EmptyDescription>Paid checkouts and withdrawals will appear here with settlement references.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function BalanceActivityRow({
  activity,
  onCopyReference,
}: {
  activity: BalanceActivity
  onCopyReference: (value: string) => void
}) {
  const referenceValue = activity.referenceValue

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
              activity.direction === 'inflow' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'
            }`}
          >
            {activity.direction === 'inflow' ? <ArrowUpRightIcon className="size-4" /> : <ArrowDownToLineIcon className="size-4" />}
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{activity.title}</span>
            <span className="block max-w-[360px] truncate text-xs text-muted-foreground">{activity.subtitle}</span>
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className={`font-medium ${activity.direction === 'inflow' ? 'text-emerald-700' : 'text-amber-700'}`}>
            {formatSignedMinorUnits(activity.minorUnits, activity.direction)}
          </span>
          {typeof activity.grossMinorUnits === 'number' ? (
            <span className="text-xs text-muted-foreground">gross {formatMinorUnits(activity.grossMinorUnits)}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex max-w-[300px] items-center gap-2">
          <span className="min-w-20 text-xs text-muted-foreground">{activity.referenceLabel}</span>
          {activity.referenceHref && referenceValue ? (
            <a
              className="min-w-0 truncate font-mono text-xs underline-offset-2 hover:underline"
              href={activity.referenceHref}
              rel="noopener noreferrer"
              target="_blank"
              title={referenceValue}
            >
              {compact(referenceValue)}
            </a>
          ) : (
            <span className="min-w-0 truncate font-mono text-xs">{compact(referenceValue)}</span>
          )}
          {referenceValue ? (
            <Button aria-label={`Copy ${activity.referenceLabel}`} onClick={() => onCopyReference(referenceValue)} size="icon" type="button" variant="ghost">
              <CopyIcon className="size-3.5" />
            </Button>
          ) : null}
          {activity.referenceHref ? (
            <a
              aria-label={`Open ${activity.referenceLabel} in Etherscan`}
              className={buttonVariants({ size: 'icon', variant: 'ghost' })}
              href={activity.referenceHref}
              rel="noopener noreferrer"
              target="_blank"
              title={`Open ${activity.referenceLabel} in Etherscan`}
            >
              <ExternalLinkIcon className="size-3.5" />
            </a>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <StatusBadge value={activity.status} />
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">{formatTime(activity.occurredAt)}</TableCell>
    </TableRow>
  )
}

export function projectBalanceActivities(overview: ProjectDashboardOverview): BalanceActivity[] {
  const paymentTxBySession = new Map<string, string>()

  for (const event of overview.webhookEvents) {
    if (event.eventType !== 'invoice.fulfillment_ready') {
      continue
    }

    const checkoutSessionId = payloadString(event.payload, 'checkoutSessionId')
    const paymentTxHash = payloadString(event.payload, 'paymentTxHash')

    if (checkoutSessionId && paymentTxHash) {
      paymentTxBySession.set(checkoutSessionId, paymentTxHash)
    }
  }

  const inflows = overview.checkoutSessions
    .filter((session) => session.status === 'paid')
    .map((session): BalanceActivity => {
      const paymentTxHash = paymentTxBySession.get(session.checkoutSessionId)

      return {
        direction: 'inflow',
        grossMinorUnits: session.billing.grossAmountMinorUnits,
        id: `checkout-${session.checkoutSessionId}`,
        minorUnits: session.billing.merchantNetMinorUnits,
        occurredAt: session.updatedAt,
        referenceHref: transactionExplorerHref(session.environment, paymentTxHash ?? null),
        referenceLabel: 'Payment tx',
        referenceValue: paymentTxHash ?? null,
        status: session.status,
        subtitle: `${session.title} - invoice #${session.chainInvoiceId}`,
        title: 'Checkout paid',
      }
    })

  const outflows = overview.withdrawals.map(
    (withdrawal): BalanceActivity => ({
      direction: 'outflow',
      id: `withdrawal-${withdrawal.withdrawalId}`,
      minorUnits: withdrawal.amountMinorUnits,
      occurredAt: withdrawal.completedAt,
      referenceHref: transactionExplorerHref(overview.project.defaultEnvironment, withdrawal.receipt),
      referenceLabel: 'Receipt',
      referenceValue: withdrawal.receipt,
      status: withdrawal.status,
      subtitle: withdrawal.withdrawalId,
      title: 'Withdraw completed',
    }),
  )

  return [...inflows, ...outflows].sort((left, right) => activityTimestamp(right) - activityTimestamp(left))
}

function transactionExplorerHref(environment: ProjectEnvironmentKind, txHash: string | null): string | null {
  if (!txHash || !TRANSACTION_HASH_PATTERN.test(txHash)) {
    return null
  }

  const config = contractEnvironmentConfig(environment)
  const explorerUrl = config.walletChain.blockExplorerUrls?.[0] ?? config.chain.blockExplorers?.default.url

  return explorerUrl ? `${explorerUrl.replace(/\/$/, '')}/tx/${txHash}` : null
}

function buildBalanceTrend(activities: BalanceActivity[], range: BalanceRangeKey): BalanceTrend {
  const events = activities
    .map((activity) => ({
      deltaMinorUnits: activity.direction === 'inflow' ? activity.minorUnits : -activity.minorUnits,
      timestamp: activityTimestamp(activity),
    }))
    .filter((event) => event.timestamp > 0)
    .sort((left, right) => left.timestamp - right.timestamp)

  if (events.length === 0) {
    return {
      currentBalanceMinorUnits: 0,
      netChangeMinorUnits: 0,
      openingBalanceMinorUnits: 0,
      points: [buildTrendPoint(Date.now(), 0, 0, 0)],
      spanMs: 0,
    }
  }

  const lastTimestamp = events[events.length - 1].timestamp
  const firstTimestamp = events[0].timestamp
  const rangeStart = rangeStartTimestamp({ firstTimestamp, lastTimestamp, range })
  const openingBalanceMinorUnits = events
    .filter((event) => event.timestamp < rangeStart)
    .reduce((sum, event) => sum + event.deltaMinorUnits, 0)
  const points: BalanceTrendPoint[] = [buildTrendPoint(rangeStart, openingBalanceMinorUnits, 0, 0)]
  let balanceMinorUnits = openingBalanceMinorUnits

  for (const event of events) {
    if (event.timestamp < rangeStart) {
      continue
    }

    const inflowMinorUnits = event.deltaMinorUnits > 0 ? event.deltaMinorUnits : 0
    const outflowMinorUnits = event.deltaMinorUnits < 0 ? Math.abs(event.deltaMinorUnits) : 0
    balanceMinorUnits += event.deltaMinorUnits
    points.push(buildTrendPoint(event.timestamp, balanceMinorUnits, inflowMinorUnits, outflowMinorUnits))
  }

  return {
    currentBalanceMinorUnits: balanceMinorUnits,
    netChangeMinorUnits: balanceMinorUnits - openingBalanceMinorUnits,
    openingBalanceMinorUnits,
    points,
    spanMs: Math.max(lastTimestamp - rangeStart, HOUR_MS),
  }
}

function buildTrendPoint(
  timestamp: number,
  balanceMinorUnits: number,
  inflowMinorUnits: number,
  outflowMinorUnits: number,
): BalanceTrendPoint {
  return {
    balance: balanceMinorUnits / 1_000_000,
    balanceMinorUnits,
    fullLabel: formatTime(new Date(timestamp).toISOString()),
    inflowMinorUnits,
    netMinorUnits: inflowMinorUnits - outflowMinorUnits,
    outflowMinorUnits,
    timestamp,
  }
}

function rangeStartTimestamp({
  firstTimestamp,
  lastTimestamp,
  range,
}: {
  firstTimestamp: number
  lastTimestamp: number
  range: BalanceRangeKey
}) {
  if (range === 'all') {
    return firstTimestamp - HOUR_MS
  }

  const rangeMs = range === '24h' ? DAY_MS : range === '7d' ? 7 * DAY_MS : 30 * DAY_MS
  return Math.max(firstTimestamp - HOUR_MS, lastTimestamp - rangeMs)
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function activityTimestamp(activity: Pick<BalanceActivity, 'occurredAt'>) {
  const timestamp = Date.parse(activity.occurredAt)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function formatAxisCusdt(value: number) {
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function formatChartTick(timestamp: number, spanMs: number) {
  const date = new Date(timestamp)

  if (spanMs <= 2 * DAY_MS) {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(date)
  }

  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short' }).format(date)
}

function formatSignedMinorUnits(value: number, direction?: BalanceActivity['direction']) {
  if (value === 0) {
    return formatMinorUnits(0)
  }

  const sign = direction ? (direction === 'inflow' ? '+' : '-') : value > 0 ? '+' : '-'
  return `${sign}${formatMinorUnits(Math.abs(value))}`
}
