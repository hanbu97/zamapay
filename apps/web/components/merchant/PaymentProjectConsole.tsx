'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowDownToLineIcon,
  BellRingIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LandmarkIcon,
  RadioTowerIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { StatusBadge } from '@/components/commerce/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  configureProjectWebhook,
  createProjectWithdrawal,
  createProjectApiKey,
  getProjectOverview,
  resendProjectWebhookDelivery,
  testProjectWebhook,
  type BillingSubscriptionResponse,
  type ProjectDashboardOverview,
  type WebhookDeliveryRecord,
} from '@/lib/api'
import {
  CodeBlock,
  FactRow,
  MerchantSetupFlow,
  MetricCard,
  OneTimeSecretDialog,
  buildEnvExport,
  buildIntegrationBundle,
  compact,
  copyText,
  formatBillingPlan,
  formatBps,
  formatCheckoutFee,
  formatEnvironment,
  formatMinorUnits,
  formatTime,
  type OneTimeSecret,
} from './PaymentProjectConsoleParts'

export type ProjectConsoleTab = 'overview' | 'integration' | 'webhooks' | 'payments' | 'diagnostics'

type PaymentProjectConsoleProps = {
  initialBilling: BillingSubscriptionResponse
  initialOverview: ProjectDashboardOverview
  initialTab?: ProjectConsoleTab
  ownerAddress: string
}

function normalizeTab(value: string | undefined): ProjectConsoleTab {
  if (value === 'integration' || value === 'webhooks' || value === 'payments' || value === 'diagnostics') {
    return value
  }

  return 'overview'
}

export function PaymentProjectConsole({
  initialBilling,
  initialOverview,
  initialTab,
  ownerAddress,
}: PaymentProjectConsoleProps) {
  const router = useRouter()
  const [overview, setOverview] = useState(initialOverview)
  const [webhookUrl, setWebhookUrl] = useState(overview.webhookEndpoints[0]?.url ?? 'http://127.0.0.1:8092/api/mermer-pay/webhook')
  const [apiKeyLabel, setApiKeyLabel] = useState('Merchant backend')
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecret | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'
  const project = overview.project
  const environment = overview.environments[0] ?? null
  const activeTab = normalizeTab(initialTab)
  const currentPlanCatalog = initialBilling.plans.find((plan) => plan.plan === initialBilling.subscription.plan)
  const integrationSnippet = [
    buildEnvExport('MERMER_PAY_PROJECT_ID', project.projectId),
    buildEnvExport('MERMER_PAY_API_KEY', '<generated once>'),
    buildEnvExport('MERMER_PAY_API_URL', apiBaseUrl),
    buildEnvExport('MERMER_PAY_WEBHOOK_SECRET', '<shown once when webhook is created>'),
  ].join('\n')

  function revealOneTimeSecret(secret: Omit<OneTimeSecret, 'copied'>) {
    setOneTimeSecret({ ...secret, copied: false })
  }

  async function copyOneTimeSecret() {
    if (!oneTimeSecret) {
      return
    }

    await navigator.clipboard.writeText(oneTimeSecret.value)
    setOneTimeSecret({ ...oneTimeSecret, copied: true })
    setStatus(`${oneTimeSecret.copyLabel} copied to clipboard.`)
  }

  function closeCopiedSecret() {
    if (oneTimeSecret) {
      setOneTimeSecret(null)
    }
  }

  async function refresh() {
    const nextOverview = await getProjectOverview(project.projectId, '')
    setOverview(nextOverview)
    router.refresh()
  }

  async function runAction(actionId: string, action: () => Promise<void>) {
    setBusyAction(actionId)
    setError(null)

    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction('create-key', async () => {
      const created = await createProjectApiKey(project.projectId, {
        environment: project.defaultEnvironment,
        label: apiKeyLabel,
      })
      setStatus('API key created. Paste the export line into the standalone merchant backend terminal.')
      revealOneTimeSecret({
        copyLabel: 'Shell export',
        description: 'This project API key is shown once. Paste this export line into the merchant backend terminal as a server-side secret.',
        title: 'Copy API key export',
        value: buildEnvExport('MERMER_PAY_API_KEY', created.apiKey),
      })
      await refresh()
    })
  }

  async function handleConfigureWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction('configure-webhook', async () => {
      const configured = await configureProjectWebhook(project.projectId, {
        environment: project.defaultEnvironment,
        url: webhookUrl,
      })
      setStatus('Webhook endpoint created. Paste the export line into the standalone merchant backend terminal.')
      if (configured.webhookSecret) {
        revealOneTimeSecret({
          copyLabel: 'Shell export',
          description: 'This webhook secret is shown once. Paste this export line into the merchant backend terminal so callbacks can be verified.',
          title: 'Copy webhook secret export',
          value: buildEnvExport('MERMER_PAY_WEBHOOK_SECRET', configured.webhookSecret),
        })
      }
      await refresh()
    })
  }

  async function handleTestWebhook(endpointId: string) {
    await runAction(`test-${endpointId}`, async () => {
      await testProjectWebhook(project.projectId, endpointId)
      setStatus('Webhook test dispatched. Check delivery status below.')
      await refresh()
    })
  }

  async function handleResend(delivery: WebhookDeliveryRecord) {
    await runAction(`resend-${delivery.deliveryId}`, async () => {
      await resendProjectWebhookDelivery(project.projectId, delivery.deliveryId)
      setStatus('Webhook delivery resent.')
      await refresh()
    })
  }

  async function handleWithdraw() {
    await runAction('withdraw', async () => {
      const nextOverview = await createProjectWithdrawal(project.projectId)
      setOverview(nextOverview)
      setStatus('Withdraw recorded against the local settlement balance.')
      router.refresh()
    })
  }

  return (
    <div className="mermer-flow-stack flex flex-col">
      <OneTimeSecretDialog
        onClose={closeCopiedSecret}
        onCopy={copyOneTimeSecret}
        onOpenChange={(open) => {
          if (!open) {
            closeCopiedSecret()
          }
        }}
        secret={oneTimeSecret}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : status ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Project control plane</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={activeTab}>
        <TabsContent value="overview">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-4">
              <MetricCard label="Total checkouts" value={overview.summary.totalCheckouts} />
              <MetricCard label="Paid gross" value={formatMinorUnits(overview.summary.grossVolumeMinorUnits)} />
              <MetricCard label="Pending deliveries" value={overview.summary.pendingDeliveries} />
              <MetricCard label="Checkout fee" value={formatBps(currentPlanCatalog?.checkoutFeeBps)} />
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
              <Card size="sm">
                <CardHeader>
                  <CardAction>
                    <Badge variant={environment?.status === 'active' ? 'secondary' : 'outline'}>
                      {formatEnvironment(project.defaultEnvironment)}
                    </Badge>
                  </CardAction>
                  <CardTitle>{project.name}</CardTitle>
                  <CardDescription>
                    Owner {compact(ownerAddress)}. Project ID {project.projectId}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <FactRow label="Signer" value={environment ? 'platform hosted' : 'none'} />
                      <FactRow label="Chain ID" value={environment?.chainId?.toString() ?? 'local'} />
                      <FactRow label="Settlement" value={compact(environment?.settlementContract ?? null)} />
                      <FactRow label="Subscription plan" value={formatBillingPlan(initialBilling.subscription.plan)} />
                      <FactRow label="New checkout fee" value={formatBps(currentPlanCatalog?.checkoutFeeBps)} />
                      <FactRow label="Checkout sessions" value={overview.summary.totalCheckouts} />
                      <FactRow label="Pending deliveries" value={overview.summary.pendingDeliveries} />
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <MerchantSetupFlow overview={overview} selectedProject={project} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="integration">
          <div className="mermer-section-grid grid items-start xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
            <MerchantSetupFlow overview={overview} selectedProject={project} />

            <div className="mermer-section-grid grid lg:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardAction>
                    <Badge variant="outline">{overview.apiKeys.length}</Badge>
                  </CardAction>
                  <CardTitle>API key</CardTitle>
                  <CardDescription>Merchant backends use project API keys. Buyer browsers never forward merchant cookies.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <form onSubmit={handleCreateApiKey}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="api-key-label">Key label</FieldLabel>
                        <InputGroup>
                          <InputGroupAddon>
                            <KeyRoundIcon />
                          </InputGroupAddon>
                          <InputGroupInput id="api-key-label" onChange={(event) => setApiKeyLabel(event.target.value)} value={apiKeyLabel} />
                        </InputGroup>
                      </Field>
                      <Button disabled={busyAction === 'create-key'} type="submit">
                        {busyAction === 'create-key' ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                        Generate API key
                      </Button>
                    </FieldGroup>
                  </form>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead className="text-right">State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.apiKeys.map((key) => (
                        <TableRow key={key.keyId}>
                          <TableCell className="font-mono text-xs">{key.prefix}</TableCell>
                          <TableCell>{key.label}</TableCell>
                          <TableCell className="text-right">
                            <StatusBadge value={key.revokedAt ? 'revoked' : 'active'} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Backend environment</CardTitle>
                  <CardDescription>Use these values in a standalone merchant backend.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <CodeBlock actionLabel="Copy exports" onCopy={() => copyText(integrationSnippet, setStatus)} value={integrationSnippet} />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="webhooks">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Endpoint</CardTitle>
                <CardDescription>Project outbox signs immutable events and records delivery attempts.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <form onSubmit={handleConfigureWebhook}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="webhook-url">Webhook URL</FieldLabel>
                      <InputGroup>
                        <InputGroupAddon>
                          <RadioTowerIcon />
                        </InputGroupAddon>
                        <InputGroupInput id="webhook-url" onChange={(event) => setWebhookUrl(event.target.value)} value={webhookUrl} />
                      </InputGroup>
                    </Field>
                    <Button disabled={busyAction === 'configure-webhook'} type="submit">
                      {busyAction === 'configure-webhook' ? <Spinner data-icon="inline-start" /> : <BellRingIcon data-icon="inline-start" />}
                      Add endpoint
                    </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardAction>
                  <Badge variant="outline">{overview.webhookEndpoints.length}</Badge>
                </CardAction>
                <CardTitle>Deliveries</CardTitle>
                <CardDescription>Retry and dead-letter state is visible per project.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.webhookEndpoints.map((endpoint) => (
                      <TableRow key={endpoint.endpointId}>
                        <TableCell>
                          <div className="flex max-w-[360px] flex-col gap-1">
                            <span className="truncate font-medium">{endpoint.url}</span>
                            <span className="truncate font-mono text-xs text-muted-foreground">{endpoint.secretPreview}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge value={endpoint.enabled ? 'enabled' : 'disabled'} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button disabled={busyAction === `test-${endpoint.endpointId}`} onClick={() => handleTestWebhook(endpoint.endpointId)} size="sm" variant="outline">
                            {busyAction === `test-${endpoint.endpointId}` ? <Spinner data-icon="inline-start" /> : <BellRingIcon data-icon="inline-start" />}
                            Test
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">HTTP</TableHead>
                      <TableHead className="text-right">Retry</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.webhookDeliveries.map((delivery) => (
                      <TableRow key={delivery.deliveryId}>
                        <TableCell className="font-mono text-xs">{compact(delivery.deliveryId)}</TableCell>
                        <TableCell>
                          <StatusBadge value={delivery.status} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{delivery.httpStatus ?? delivery.error ?? 'pending'}</TableCell>
                        <TableCell className="text-right">
                          <Button disabled={busyAction === `resend-${delivery.deliveryId}`} onClick={() => handleResend(delivery)} size="sm" variant="ghost">
                            {busyAction === `resend-${delivery.deliveryId}` ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
                            Resend
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <Card size="sm">
            <CardHeader>
              <CardAction>
                <Badge variant="secondary">{overview.summary.totalCheckouts}</Badge>
              </CardAction>
              <CardTitle>Checkout sessions</CardTitle>
              <CardDescription>Project payments created through project API-key auth.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Checkout</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Fee</TableHead>
                    <TableHead className="hidden md:table-cell">Chain invoice</TableHead>
                    <TableHead className="text-right">Status</TableHead>
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
                            <span className="truncate font-mono text-xs text-muted-foreground">{session.checkoutSessionId}</span>
                          </div>
                        </TableCell>
                        <TableCell>{session.amountLabel}</TableCell>
                        <TableCell className="hidden md:table-cell">{formatCheckoutFee(session)}</TableCell>
                        <TableCell className="hidden font-mono text-xs md:table-cell">{session.chainInvoiceId}</TableCell>
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
                            <EmptyDescription>Connect a merchant backend with this project's API key.</EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostics">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Paid gross" value={formatMinorUnits(overview.summary.grossVolumeMinorUnits)} />
            <MetricCard label="Platform fees" value={formatMinorUnits(overview.summary.platformFeeMinorUnits)} />
            <MetricCard label="Merchant net" value={formatMinorUnits(overview.summary.merchantNetMinorUnits)} />
          </div>
          <Card className="mt-4" size="sm">
            <CardHeader>
              <CardAction>
                <Badge variant={overview.summary.withdrawableMinorUnits > 0 ? 'default' : 'secondary'}>
                  <LandmarkIcon data-icon="inline-start" />
                  {formatMinorUnits(overview.summary.withdrawableMinorUnits)}
                </Badge>
              </CardAction>
              <CardTitle>Withdraw</CardTitle>
              <CardDescription>
                Local-dev records payout settlement from paid merchant net; private public-network withdraw remains a later contract path.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="grid gap-2 text-sm md:min-w-96">
                <WithdrawFact label="Available" value={formatMinorUnits(overview.summary.withdrawableMinorUnits)} />
                <WithdrawFact label="Withdrawn" value={formatMinorUnits(overview.summary.withdrawnMinorUnits)} />
                <WithdrawFact label="Records" value={overview.withdrawals.length} />
              </div>
              <Button
                disabled={busyAction === 'withdraw' || overview.summary.withdrawableMinorUnits <= 0}
                onClick={handleWithdraw}
                type="button"
              >
                {busyAction === 'withdraw' ? <Spinner data-icon="inline-start" /> : <ArrowDownToLineIcon data-icon="inline-start" />}
                Withdraw available
              </Button>
            </CardContent>
          </Card>
          <Card className="mt-4" size="sm">
            <CardHeader>
              <CardTitle>Events</CardTitle>
              <CardDescription>Immutable project events emitted from settlement projection.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.webhookEvents.map((event) => (
                    <TableRow key={event.eventId}>
                      <TableCell>{event.eventType}</TableCell>
                      <TableCell className="max-w-[360px] truncate font-mono text-xs">{event.subjectId}</TableCell>
                      <TableCell className="text-right">{formatTime(event.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WithdrawFact({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-md border bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
