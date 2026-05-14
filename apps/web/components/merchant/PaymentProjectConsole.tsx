'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  ArrowDownToLineIcon,
  BellRingIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LandmarkIcon,
  PowerIcon,
  PowerOffIcon,
  RadioTowerIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
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
  createProjectSecret,
  createProjectWithdrawal,
  getProjectOverview,
  resendProjectWebhookDelivery,
  rotateProjectWebhookSecret,
  testProjectWebhook,
  updateProjectPaymentRail,
  type BillingSubscriptionResponse,
  type PaymentRail,
  type ProjectDashboardOverview,
  type EvmSettlementLedgerEntry,
  type WebhookDeliveryRecord,
} from '@/lib/api'
import { formatTokenUnits } from '@/lib/amount-format'
import {
  formatCheckoutAmountForProject,
  formatCheckoutFeeForProject,
  formatProjectMinorUnits,
  projectBalanceSymbol,
} from '@/lib/project-amounts'
import {
  paymentRailDescriptors,
  paymentRailLabel,
  paymentRailTruthSource,
  projectPaymentRailSetting,
} from '@/lib/payment-rails'
import {
  CodeBlock,
  EvmAssetBalancesCard,
  FactRow,
  MerchantSetupFlow,
  MetricCard,
  OneTimeSecretDialog,
  buildIntegrationBundle,
  compact,
  copyText,
  formatBps,
  formatMinorUnits,
  formatTime,
  type OneTimeSecret,
} from './PaymentProjectConsoleParts'
import {
  BalanceActivityCard,
  BalanceTrendCard,
  projectBalanceActivities,
  type BalanceRangeKey,
} from './PaymentProjectBalance'
import {
  clearPendingProjectWithdraw,
  projectWithdrawPayload,
  runProjectWithdraw,
  verifiedPendingProjectWithdraws,
} from './PaymentProjectWithdraw'
import {
  localProjectEvmWithdrawAsset,
  runLocalProjectEvmWithdraw,
} from './PaymentProjectEvmWithdraw'

export type ProjectConsoleTab = 'overview' | 'integration' | 'webhooks' | 'payments'
const defaultProjectWebhookUrl =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_WEBHOOK_URL ?? 'http://127.0.0.1:8092/api/zamapay/webhook'

type PaymentProjectConsoleProps = {
  initialBilling: BillingSubscriptionResponse | null
  initialOverview: ProjectDashboardOverview
  initialTab?: ProjectConsoleTab
  ownerAddress: string
  readOnly?: boolean
}

function normalizeTab(value: string | undefined): ProjectConsoleTab {
  if (value === 'diagnostics' || value === 'withdraw') {
    return 'overview'
  }
  if (value === 'integration' || value === 'webhooks' || value === 'payments') {
    return value
  }

  return 'overview'
}

function isAlreadyProjectedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('withdraw transaction is already projected')
}

export function PaymentProjectConsole({
  initialBilling,
  initialOverview,
  initialTab,
  ownerAddress,
  readOnly = false,
}: PaymentProjectConsoleProps) {
  const router = useRouter()
  const [overview, setOverview] = useState(initialOverview)
  const [webhookUrl, setWebhookUrl] = useState(overview.webhookEndpoints[0]?.url ?? defaultProjectWebhookUrl)
  const [secretLabel, setSecretLabel] = useState('Merchant backend')
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecret | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [balanceRange, setBalanceRange] = useState<BalanceRangeKey>('7d')
  const project = overview.project
  const balanceActivities = useMemo(() => projectBalanceActivities(overview), [overview])
  const activeTab = normalizeTab(initialTab)
  const activeBillingPlan = initialBilling?.subscription.plan
  const currentPlanCatalog = activeBillingPlan ? initialBilling?.plans.find((plan) => plan.plan === activeBillingPlan) : null
  const checkoutFeeBps = currentPlanCatalog?.checkoutFeeBps ?? projectedCheckoutFeeBps(overview)
  const integrationSnippet = buildIntegrationBundle({
    secretKey: '<generated once>',
  })

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
    if (readOnly) {
      setStatus('Demo dashboard is read-only. Log in as the project owner to manage it.')
      return
    }

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

  async function handleCreateProjectSecret(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction('create-key', async () => {
      const created = await createProjectSecret(project.projectId, {
        environment: project.defaultEnvironment,
        label: secretLabel,
      })
      setStatus('Project secret key created. Paste the export line into the standalone merchant backend terminal.')
      revealOneTimeSecret({
        copyLabel: 'Shell export',
        description: 'This project secret key is shown once. It authenticates checkout creation and bootstraps webhook verifier context on the merchant backend.',
        title: 'Copy project secret key',
        value: buildIntegrationBundle({ secretKey: created.secretKey }),
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
      setStatus(`Webhook endpoint ${configured.endpoint.endpointId} created. Merchant backends refresh verifier context through ZAMAPAY_SECRET_KEY.`)
      await refresh()
    })
  }

  async function handleRotateWebhookSecret(endpointId: string) {
    await runAction(`rotate-${endpointId}`, async () => {
      await rotateProjectWebhookSecret(project.projectId, endpointId)
      setStatus('Webhook secret rotated. Restart the merchant backend so it bootstraps the current verifier secret before the retired secret expires.')
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

  async function handleTogglePaymentRail(paymentRail: PaymentRail) {
    const current = projectPaymentRailSetting(overview, paymentRail)
    const enabled = !current.enabled
    await runAction(`rail-${paymentRail}`, async () => {
      const updated = await updateProjectPaymentRail(project.projectId, paymentRail, { enabled })
      setOverview(updated)
      setStatus(`${paymentRailLabel(paymentRail)} payment method ${enabled ? 'enabled' : 'disabled'}.`)
      router.refresh()
    })
  }

  async function handleWithdraw() {
    await runAction('withdraw', async () => {
      const latestOverview = await getProjectOverview(project.projectId, '')
      setOverview(latestOverview)
      const amountMinorUnits = latestOverview.summary.withdrawableMinorUnits
      if (amountMinorUnits <= 0) {
        setStatus('Project balance is already fully withdrawn.')
        router.refresh()
        return
      }

      if (localProjectEvmWithdrawAsset(latestOverview, amountMinorUnits)) {
        const submitted = await runLocalProjectEvmWithdraw({
          amountMinorUnits,
          overview: latestOverview,
          recipientAddress: ownerAddress,
          setStatus,
        })
        const projected = await createProjectWithdrawal(project.projectId, {
          amountMinorUnits,
          chainId: submitted.chainId,
          chainTxHash: submitted.chainTxHash,
          settlementContract: submitted.settlementContract,
          recipientAddress: submitted.recipientAddress,
          tokenContract: submitted.tokenContract,
        })
        setOverview(projected)
        setStatus('Local ERC20 settlement withdraw completed and projected into the project balance.')
        router.refresh()
        return
      }

      if (await recoverPendingWithdrawProjection()) {
        return
      }

      const submitted = await runProjectWithdraw({
        amountMinorUnits,
        environment: project.defaultEnvironment,
        ownerAddress,
        projectId: project.projectId,
        setStatus,
      })
      const projected = await createProjectWithdrawal(project.projectId, {
        amountMinorUnits,
        chainTxHash: submitted.chainTxHash,
        recipientAddress: submitted.recipientAddress,
        settlementBucketCommitment: submitted.settlementBucketCommitment,
        withdrawalNonce: submitted.withdrawalNonce,
        withdrawCheckHandle: submitted.withdrawCheckHandle,
      })
      clearPendingProjectWithdraw(project.projectId, submitted.chainTxHash)
      setOverview(projected)
      setStatus('Encrypted withdraw completed and projected into the project balance.')
      router.refresh()
    })
  }

  async function recoverPendingWithdrawProjection(): Promise<boolean> {
    const pending = await verifiedPendingProjectWithdraws({
      environment: project.defaultEnvironment,
      projectId: project.projectId,
      setStatus,
    })
    if (pending.length === 0) {
      return false
    }

    let projected: ProjectDashboardOverview | null = null
    for (const withdraw of pending) {
      try {
        projected = await createProjectWithdrawal(project.projectId, projectWithdrawPayload(withdraw))
      } catch (caught) {
        if (!isAlreadyProjectedError(caught)) {
          throw caught
        }
      }
      clearPendingProjectWithdraw(project.projectId, withdraw.chainTxHash)
    }

    setOverview(projected ?? await getProjectOverview(project.projectId, ''))
    setStatus('Recovered a mined Sepolia withdraw and updated the project balance.')
    router.refresh()
    return true
  }

  return (
    <div className="zamapay-flow-stack flex flex-col">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Total checkouts" value={overview.summary.totalCheckouts} />
              <MetricCard label="Paid gross" value={formatProjectMinorUnits(overview.summary.grossVolumeMinorUnits, overview)} />
              <MetricCard label="Pending deliveries" value={overview.summary.pendingDeliveries} />
              <MetricCard label="Checkout fee" value={formatBps(checkoutFeeBps)} />
              <WithdrawMetricCard busyAction={busyAction} onWithdraw={handleWithdraw} overview={overview} readOnly={readOnly} />
            </div>

            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Project basics</CardTitle>
                  <CardDescription>Only the identity fields needed to recognize this project.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableBody>
                      <FactRow label="Owner" value={compact(ownerAddress)} />
                      <FactRow label="Project ID" value={compact(project.projectId)} />
                      <FactRow label="Created" value={formatTime(project.createdAt)} />
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <BalanceTrendCard activities={balanceActivities} onRangeChange={setBalanceRange} range={balanceRange} symbol={projectBalanceSymbol(overview)} />
            </div>

            <BalanceActivityCard activities={balanceActivities} onCopyReference={(value) => copyText(value, setStatus)} />
          </div>
        </TabsContent>

        <TabsContent value="integration">
          <div className="zamapay-section-grid grid items-start xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
            <MerchantSetupFlow overview={overview} selectedProject={project} />

            <div className="zamapay-section-grid grid lg:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardAction>
                    <Badge variant="outline">{overview.projectSecrets.length}</Badge>
                  </CardAction>
                  <CardTitle>Project secret keys</CardTitle>
                  <CardDescription>Merchant backends use project secrets. Buyer browsers never forward merchant cookies.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {readOnly ? null : (
                    <form onSubmit={handleCreateProjectSecret}>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="secret-label">Secret label</FieldLabel>
                          <InputGroup>
                            <InputGroupAddon>
                              <KeyRoundIcon />
                            </InputGroupAddon>
                            <InputGroupInput id="secret-label" onChange={(event) => setSecretLabel(event.target.value)} value={secretLabel} />
                          </InputGroup>
                        </Field>
                        <Button disabled={busyAction === 'create-key'} type="submit">
                          {busyAction === 'create-key' ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                          Generate secret key
                        </Button>
                      </FieldGroup>
                    </form>
                  )}

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Prefix</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead className="text-right">State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.projectSecrets.map((key) => (
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
                  <CardTitle>Merchant server environment</CardTitle>
                  <CardDescription>One server-side project secret; rail-specific fields belong to each checkout request.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <CodeBlock actionLabel="Copy exports" onCopy={() => copyText(integrationSnippet, setStatus)} value={integrationSnippet} />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="webhooks">
          <div className={`grid items-start gap-4 ${readOnly ? 'xl:grid-cols-1' : 'xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]'}`}>
            {readOnly ? null : (
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
            )}

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
                      {readOnly ? null : <TableHead className="text-right">Action</TableHead>}
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
                        {readOnly ? null : (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button disabled={busyAction === `test-${endpoint.endpointId}`} onClick={() => handleTestWebhook(endpoint.endpointId)} size="sm" variant="outline">
                                {busyAction === `test-${endpoint.endpointId}` ? <Spinner data-icon="inline-start" /> : <BellRingIcon data-icon="inline-start" />}
                                Test
                              </Button>
                              <Button disabled={busyAction === `rotate-${endpoint.endpointId}`} onClick={() => handleRotateWebhookSecret(endpoint.endpointId)} size="sm" variant="ghost">
                                {busyAction === `rotate-${endpoint.endpointId}` ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                                Rotate
                              </Button>
                            </div>
                          </TableCell>
                        )}
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
                      {readOnly ? null : <TableHead className="text-right">Retry</TableHead>}
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
                        {readOnly ? null : (
                          <TableCell className="text-right">
                            <Button disabled={busyAction === `resend-${delivery.deliveryId}`} onClick={() => handleResend(delivery)} size="sm" variant="ghost">
                              {busyAction === `resend-${delivery.deliveryId}` ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
                              Resend
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <div className="grid gap-4">
            <PaymentMethodsCard
              busyAction={busyAction}
              onToggle={handleTogglePaymentRail}
              overview={overview}
              readOnly={readOnly}
            />

            <Card size="sm">
              <CardHeader>
                <CardAction>
                  <Badge variant="secondary">{overview.supportedEvmAssets.length}</Badge>
                </CardAction>
                <CardTitle>ERC20 settlement rails</CardTitle>
                <CardDescription>Enabled network, token, RPC, and settlement contract combinations.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="hidden md:table-cell">Settlement</TableHead>
                      <TableHead className="text-right">Finality</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.supportedEvmAssets.length > 0 ? (
                      overview.supportedEvmAssets.map((asset) => (
                        <TableRow key={`${asset.chainId}-${asset.tokenContract}-${asset.settlementContract}`}>
                          <TableCell>
                            <div className="flex max-w-[360px] flex-col gap-1">
                              <span className="font-medium">{asset.network} / {asset.tokenSymbol}</span>
                              <span className="truncate font-mono text-xs text-muted-foreground">{asset.tokenContract}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">{compact(asset.settlementContract)}</TableCell>
                          <TableCell className="text-right">{asset.finalityThreshold}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Empty className="border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <RadioTowerIcon />
                              </EmptyMedia>
                              <EmptyTitle>No ERC20 rails</EmptyTitle>
                              <EmptyDescription>Enable a chain, token, RPC node, and settlement contract first.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <EvmAssetBalancesCard overview={overview} />

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
                      <TableHead className="hidden md:table-cell">Rail</TableHead>
                      <TableHead className="hidden md:table-cell">Reference</TableHead>
                      <TableHead className="hidden lg:table-cell">Fee</TableHead>
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
                          <TableCell>{formatCheckoutAmountForProject(session, overview)}</TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex max-w-[180px] flex-col gap-1">
                              <span className="font-medium">{paymentRailLabel(session.paymentRail)}</span>
                              <span className="truncate text-xs text-muted-foreground">{paymentRailTruthSource(session.paymentRail)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">{checkoutReference(session)}</TableCell>
                          <TableCell className="hidden lg:table-cell">{formatCheckoutFeeForProject(session, overview)}</TableCell>
                          <TableCell className="text-right">
                            <StatusBadge value={session.status} />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Empty className="border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <ReceiptTextIcon />
                              </EmptyMedia>
                              <EmptyTitle>No checkouts yet</EmptyTitle>
                              <EmptyDescription>Connect a merchant backend with this project's secret key.</EmptyDescription>
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
                  <Badge variant="secondary">{overview.evmSettlementLedger.length}</Badge>
                </CardAction>
                <CardTitle>ERC20 settlement ledger</CardTitle>
                <CardDescription>Settlement contract payment events matched to project payment intents.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Settlement tx</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="hidden md:table-cell">Contract</TableHead>
                      <TableHead className="text-right">Confirmations</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.evmSettlementLedger.length > 0 ? (
                      overview.evmSettlementLedger.map((event) => (
                        <TableRow key={event.settlementEventId}>
                          <TableCell>
                            <div className="flex max-w-[360px] flex-col gap-1">
                              <span className="font-mono text-xs">{compact(event.txHash)}</span>
                              <StatusBadge value={event.status} />
                            </div>
                          </TableCell>
                          <TableCell>{formatEvmSettlementAmount(overview, event)}</TableCell>
                          <TableCell className="hidden font-mono text-xs md:table-cell">{compact(event.toAddress)}</TableCell>
                          <TableCell className="text-right">{event.confirmations}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Empty className="border">
                            <EmptyHeader>
                              <EmptyMedia variant="icon">
                                <RadioTowerIcon />
                              </EmptyMedia>
                              <EmptyTitle>No ERC20 settlements</EmptyTitle>
                              <EmptyDescription>The indexer has not matched a settlement payment event for this project.</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  )
}

function WithdrawMetricCard({
  busyAction,
  onWithdraw,
  overview,
  readOnly,
}: {
  busyAction: string | null
  onWithdraw: () => void
  overview: ProjectDashboardOverview
  readOnly: boolean
}) {
  return (
    <Card className="min-h-28 justify-center" size="sm">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LandmarkIcon className="size-3.5" />
            <span>Available</span>
          </div>
          {readOnly ? (
            <Badge variant="outline">Read only</Badge>
          ) : (
            <Button
              className="shrink-0"
              disabled={busyAction === 'withdraw' || overview.summary.withdrawableMinorUnits <= 0}
              onClick={onWithdraw}
              size="sm"
              title="Withdraw the currently available project balance."
              type="button"
            >
              {busyAction === 'withdraw' ? <Spinner data-icon="inline-start" /> : <ArrowDownToLineIcon data-icon="inline-start" />}
              Withdraw
            </Button>
          )}
        </div>
        <div className="text-2xl leading-none font-semibold whitespace-nowrap md:text-3xl">{formatProjectMinorUnits(overview.summary.withdrawableMinorUnits, overview)}</div>
        <CardDescription className="text-xs">{readOnly ? 'Projected chain balance' : 'Project settlement withdraw'}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function PaymentMethodsCard({
  busyAction,
  onToggle,
  overview,
  readOnly,
}: {
  busyAction: string | null
  onToggle: (paymentRail: PaymentRail) => void
  overview: ProjectDashboardOverview
  readOnly: boolean
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardAction>
          <Badge variant="secondary">
            {paymentRailDescriptors.filter((descriptor) => projectPaymentRailSetting(overview, descriptor.rail).enabled).length}
          </Badge>
        </CardAction>
        <CardTitle>Payment methods</CardTitle>
        <CardDescription>Merchant-managed receiving methods for this project.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Method</TableHead>
              <TableHead className="hidden lg:table-cell">Truth source</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Status</TableHead>
              {readOnly ? null : <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paymentRailDescriptors.map((descriptor) => {
              const setting = projectPaymentRailSetting(overview, descriptor.rail)
              const ready = paymentRailReady(overview, descriptor.rail)
              const busy = busyAction === `rail-${descriptor.rail}`

              return (
                <TableRow key={descriptor.rail}>
                  <TableCell>
                    <div className="flex max-w-[340px] items-start gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/30">
                        {descriptor.rail === 'zama_private' ? <ShieldCheckIcon /> : <RadioTowerIcon />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{descriptor.label}</span>
                          <Badge variant="outline">{descriptor.receivedAs}</Badge>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">{descriptor.setupHint}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{descriptor.truthSource}</TableCell>
                  <TableCell>
                    <StatusBadge value={ready ? 'ready' : 'locked'} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={setting.enabled ? 'enabled' : 'disabled'} />
                  </TableCell>
                  {readOnly ? null : (
                    <TableCell className="text-right">
                      <Button disabled={busy} onClick={() => onToggle(descriptor.rail)} size="sm" type="button" variant={setting.enabled ? 'outline' : 'default'}>
                        {busy ? <Spinner data-icon="inline-start" /> : setting.enabled ? <PowerOffIcon data-icon="inline-start" /> : <PowerIcon data-icon="inline-start" />}
                        {setting.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function paymentRailReady(overview: ProjectDashboardOverview, rail: PaymentRail) {
  if (rail === 'evm_erc20') {
    return overview.supportedEvmAssets.length > 0
  }

  return overview.environments.some(
    (environment) => environment.status === 'active' && Boolean(environment.settlementContract) && Boolean(environment.tokenContract),
  )
}

function projectedCheckoutFeeBps(overview: ProjectDashboardOverview): number | null {
  return overview.checkoutSessions.find((session) => typeof session.billing.feeBps === 'number')?.billing.feeBps ?? null
}

function checkoutReference(session: ProjectDashboardOverview['checkoutSessions'][number]) {
  if (session.paymentRail === 'evm_erc20') {
    return session.paymentIntentId ? compact(session.paymentIntentId) : 'pending intent'
  }

  return session.chainInvoiceId === null ? 'missing chain invoice' : String(session.chainInvoiceId)
}

function formatEvmSettlementAmount(overview: ProjectDashboardOverview, event: EvmSettlementLedgerEntry) {
  const asset = overview.evmAssetBalances.find(
    (balance) =>
      balance.chainId === event.chainId &&
      balance.tokenContract.toLowerCase() === event.tokenContract.toLowerCase(),
  )

  return formatTokenUnits(event.amountMinorUnits, asset?.tokenDecimals ?? 6, {
    symbol: asset?.tokenSymbol ?? 'ERC20',
  })
}
