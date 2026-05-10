import { CheckCircle2Icon, CopyIcon, CreditCardIcon } from 'lucide-react'
import { StatusStepper, type StatusStepperItem } from '@/components/commerce/StatusStepper'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TableCell, TableRow } from '@/components/ui/table'
import type { BillingPlan, BillingSubscriptionResponse, PaymentProject, ProjectDashboardOverview, ProjectEnvironmentKind } from '@/lib/api'
import { labelForProjectEnvironment } from '@/lib/contract-environment'
import { formatMerchantTimestamp } from '@/lib/time-format'

export type OneTimeSecret = {
  copied: boolean
  copyLabel: string
  description: string
  title: string
  value: string
}

export function OneTimeSecretDialog({
  onClose,
  onCopy,
  onOpenChange,
  secret,
}: {
  onClose: () => void
  onCopy: () => void
  onOpenChange: (open: boolean) => void
  secret: OneTimeSecret | null
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(secret)}>
      <DialogContent className="[--zamapay-dialog-width:44rem]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{secret?.title ?? 'Copy secret'}</DialogTitle>
          <DialogDescription>{secret?.description ?? 'Copy this value before continuing.'}</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="flex flex-col gap-3">
            <Badge className="w-fit" variant="outline">
              {secret.copyLabel}
            </Badge>
            <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 whitespace-pre">{secret.value}</pre>
          </div>
        ) : null}
        <DialogFooter>
          <Button disabled={!secret} onClick={onClose} type="button" variant="outline">
            Done
          </Button>
          <Button onClick={onCopy} type="button">
            {secret?.copied ? <CheckCircle2Icon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            {secret?.copied ? 'Copied' : 'Copy value'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BillingSubscriptionPanel({
  billing,
  busyPlan,
  onChangePlan,
}: {
  billing: BillingSubscriptionResponse
  busyPlan: BillingPlan | null
  onChangePlan: (plan: BillingPlan) => void
}) {
  const currentPlan = billing.subscription.plan

  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">{formatBillingPlan(currentPlan)}</Badge>
        </CardAction>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>Current subscription controls the checkout fee snapshotted onto new sessions.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-3">
          <BillingFact label="Private pass" value={billing.subscription.passId ?? 'not issued'} />
          <BillingFact label="Entitlement" value={formatEntitlementStatus(billing.subscription.entitlementStatus)} />
          <BillingFact label="Version" value={`v${billing.subscription.entitlementVersion || 1}`} />
        </div>
        {billing.plans.map((plan) => {
          const isCurrent = plan.plan === currentPlan
          const disabled = isCurrent || busyPlan !== null || !plan.selfServe

          return (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3" key={plan.plan}>
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                  <CreditCardIcon />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plan.name}</span>
                    <Badge variant="outline">{formatBps(plan.checkoutFeeBps)}</Badge>
                    <span className="text-sm text-muted-foreground">{formatPlanPrice(plan.monthlyPriceUsd)}</span>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">{plan.description}</p>
                </div>
              </div>
              <Button disabled={disabled} onClick={() => onChangePlan(plan.plan)} size="sm" type="button" variant={isCurrent ? 'secondary' : 'outline'}>
                {planButtonLabel({ isCurrent, plan: plan.plan, selfServe: plan.selfServe })}
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function BillingFact({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0 sm:border-b-0 sm:pb-0">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

function formatEntitlementStatus(status: string | undefined) {
  switch (status) {
    case 'anchored':
      return 'Private proof anchored'
    case 'contract_default':
      return 'Contract default'
    case 'pending_private_proof':
      return 'Awaiting private proof'
    case 'rejected':
      return 'Proof rejected'
    case 'local_only':
    default:
      return 'Contract default'
  }
}

export function MerchantSetupFlow({
  overview,
  selectedProject,
}: {
  overview: ProjectDashboardOverview | null
  selectedProject: PaymentProject | null
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Setup flow</CardTitle>
        <CardDescription>Create once, copy once, then let the merchant backend create checkouts by API key.</CardDescription>
      </CardHeader>
      <CardContent>
        <StatusStepper ariaLabel="Merchant project setup steps" steps={getMerchantSetupSteps({ overview, selectedProject })} />
      </CardContent>
    </Card>
  )
}

export function CodeBlock({ actionLabel, onCopy, value }: { actionLabel: string; onCopy: () => void; value: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5">{value}</pre>
      <Button className="w-fit" onClick={onCopy} size="sm" type="button" variant="outline">
        <CopyIcon data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  )
}

export function FactRow({ label, value }: { label: string; value: number | string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="max-w-[320px] truncate text-right font-medium">{value}</TableCell>
    </TableRow>
  )
}

export function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="min-h-28 justify-center" size="sm">
      <CardHeader className="gap-2">
        <div className="text-2xl leading-none font-semibold whitespace-nowrap md:text-3xl">{value}</div>
        <CardDescription className="text-sm">{label}</CardDescription>
      </CardHeader>
    </Card>
  )
}

export function formatEnvironment(value: ProjectEnvironmentKind | null | undefined) {
  return labelForProjectEnvironment(value)
}

export function formatBillingPlan(value: BillingPlan | null | undefined) {
  if (!value) {
    return 'Free'
  }

  return value[0].toUpperCase() + value.slice(1)
}

export function formatBps(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return 'Contract required'
  }

  return `${(value / 100).toFixed(2)}%`
}

function formatPlanPrice(value: number | null) {
  if (value === null) {
    return 'Custom'
  }

  return value === 0 ? '$0/mo' : `$${value}/mo`
}

function planButtonLabel({
  isCurrent,
  plan,
  selfServe,
}: {
  isCurrent: boolean
  plan: BillingPlan
  selfServe: boolean
}) {
  if (isCurrent) {
    return 'Current'
  }

  if (!selfServe) {
    return 'Contact'
  }

  return plan === 'free' ? 'Downgrade' : 'Upgrade'
}

export function formatMinorUnits(value: number) {
  return `${(value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} cUSDT`
}

export function formatCheckoutFee(session: ProjectDashboardOverview['checkoutSessions'][number]) {
  const fee = session.billing?.platformFeeMinorUnits

  return typeof fee === 'number' ? formatMinorUnits(fee) : 'not quoted'
}

export function buildIntegrationBundle({
  apiBaseUrl,
  apiKey,
  projectId,
  webhookSecret,
}: {
  apiBaseUrl: string
  apiKey: string
  projectId: string
  webhookSecret: string | null
}) {
  return [
    buildEnvExport('ZAMAPAY_PROJECT_ID', projectId),
    buildEnvExport('ZAMAPAY_API_KEY', apiKey),
    buildEnvExport('ZAMAPAY_API_URL', apiBaseUrl),
    buildEnvExport('ZAMAPAY_CHAIN_INVOICE_API_URL', 'http://127.0.0.1:3001'),
    buildEnvExport('ZAMAPAY_WEBHOOK_SECRET', webhookSecret ?? '<create a webhook endpoint first>'),
    buildEnvExport('CARDFORGE_DATABASE_URL', 'postgres://zamapay:zamapay@127.0.0.1:5432/cardforge'),
    buildEnvExport('CARDFORGE_STORE_KEY', 'local-dev'),
  ].join('\n')
}

export function buildEnvExport(key: string, value: string) {
  return `export ${key}=${shellQuote(value)}`
}

function shellQuote(value: string) {
  return `'${value.split("'").join("'\\''")}'`
}

export function compact(value: string | null | undefined) {
  if (!value) {
    return 'none'
  }

  if (value.length <= 16) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

export function formatTime(value: string) {
  return formatMerchantTimestamp(value)
}

export function copyText(value: string, setStatus: (value: string) => void) {
  void navigator.clipboard.writeText(value)
  setStatus('Copied to clipboard.')
}

function getMerchantSetupSteps({
  overview,
  selectedProject,
}: {
  overview: ProjectDashboardOverview | null
  selectedProject: PaymentProject | null
}): StatusStepperItem[] {
  const hasProject = Boolean(selectedProject)
  const hasApiKey = Boolean(overview?.apiKeys.length)
  const hasWebhook = Boolean(overview?.webhookEndpoints.length)
  const hasWebhookDelivery = Boolean(
    overview?.summary.deliveredWebhooks || overview?.summary.pendingDeliveries || overview?.summary.failedWebhooks,
  )
  const hasCheckout = Boolean(overview?.summary.totalCheckouts)

  return [
    {
      description: hasProject
        ? 'Project authority and environment are defined; billing comes from the active subscription.'
        : 'Create one merchant payment project for the standalone backend.',
      meta: selectedProject ? formatEnvironment(selectedProject.defaultEnvironment) : undefined,
      state: hasProject ? 'complete' : 'active',
      title: 'Create project',
    },
    {
      description: hasApiKey
        ? 'Backend can authenticate with project/API-key auth; no dashboard cookie forwarding is needed.'
        : 'Copy the one-time env bundle into the merchant backend.',
      state: !hasProject ? 'pending' : hasApiKey ? 'complete' : 'active',
      title: 'Copy backend config',
    },
    {
      description: hasWebhook
        ? 'Project outbox has an endpoint and signing secret.'
        : 'Configure a webhook endpoint so fulfillment can receive signed payment events.',
      state: !hasApiKey ? 'pending' : hasWebhook ? 'complete' : 'active',
      title: 'Configure webhook',
    },
    {
      description: hasWebhookDelivery
        ? 'At least one webhook attempt is visible in the delivery table.'
        : 'Send a test webhook before relying on production fulfillment.',
      state: !hasWebhook ? 'pending' : hasWebhookDelivery ? 'complete' : 'active',
      title: 'Test delivery',
    },
    {
      description: hasCheckout
        ? 'Merchant backend has created checkout sessions through the project API.'
        : 'Run a merchant backend with the copied config.',
      state: !hasWebhook ? 'pending' : hasCheckout ? 'complete' : 'active',
      title: 'Create checkout',
    },
  ]
}
