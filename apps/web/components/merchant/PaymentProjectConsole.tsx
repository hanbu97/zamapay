'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  ArrowRightIcon,
  BellRingIcon,
  CheckCircle2Icon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  RadioTowerIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  Settings2Icon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  configureProjectWebhook,
  createPaymentProject,
  createProjectApiKey,
  getPaymentProjects,
  getProjectOverview,
  resendProjectWebhookDelivery,
  testProjectWebhook,
  type PaymentProject,
  type ProjectDashboardOverview,
  type ProjectEnvironmentKind,
  type WebhookDeliveryRecord,
} from '@/lib/api'

type PaymentProjectConsoleProps = {
  initialOverview: ProjectDashboardOverview | null
  initialProjects: PaymentProject[]
  ownerAddress: string
}

const environmentOptions: Array<{ label: string; value: ProjectEnvironmentKind }> = [
  { label: 'Local dev', value: 'local_dev' },
  { label: 'Zama Sepolia', value: 'sepolia' },
]

export function PaymentProjectConsole({
  initialOverview,
  initialProjects,
  ownerAddress,
}: PaymentProjectConsoleProps) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [overview, setOverview] = useState(initialOverview)
  const [selectedProjectId, setSelectedProjectId] = useState(initialOverview?.project.projectId ?? initialProjects[0]?.projectId ?? '')
  const [projectName, setProjectName] = useState('CardForge merchant')
  const [projectEnvironment, setProjectEnvironment] = useState<ProjectEnvironmentKind>('local_dev')
  const [webhookUrl, setWebhookUrl] = useState('http://127.0.0.1:8092/api/mermer-pay/webhook')
  const [apiKeyLabel, setApiKeyLabel] = useState('CardForge backend')
  const [oneTimeApiKey, setOneTimeApiKey] = useState<string | null>(null)
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null)
  const [status, setStatus] = useState('Create a payment project, issue an API key, then connect a standalone merchant app.')
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) ?? overview?.project ?? null,
    [overview?.project, projects, selectedProjectId],
  )
  const selectedEnvironment = overview?.environments[0] ?? null
  const integrationSnippet = selectedProject
    ? [
        `MERMER_PAY_PROJECT_ID=${selectedProject.projectId}`,
        'MERMER_PAY_API_KEY=<generated once>',
        `MERMER_PAY_API_URL=${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8080'}`,
        `MERMER_PAY_WEBHOOK_SECRET=${webhookSecret ?? '<shown once when webhook is created>'}`,
      ].join('\n')
    : ''

  async function refresh(projectId = selectedProjectId) {
    const nextProjects = await getPaymentProjects('')
    const nextOverview = projectId ? await getProjectOverview(projectId, '') : null
    setProjects(nextProjects)
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

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runAction('create-project', async () => {
      const created = await createPaymentProject({
        environment: projectEnvironment,
        name: projectName,
        webhookUrl: webhookUrl.trim() ? webhookUrl : undefined,
      })
      setProjects((current) => [created.project, ...current.filter((project) => project.projectId !== created.project.projectId)])
      setOverview({
        apiKeys: [],
        checkoutSessions: [],
        environments: [created.environment],
        project: created.project,
        summary: {
          deliveredWebhooks: 0,
          failedWebhooks: 0,
          openCheckouts: 0,
          paidCheckouts: 0,
          pendingDeliveries: 0,
          totalCheckouts: 0,
        },
        webhookDeliveries: [],
        webhookEndpoints: created.webhookEndpoint ? [created.webhookEndpoint] : [],
        webhookEvents: [],
      })
      setSelectedProjectId(created.project.projectId)
      setWebhookSecret(created.webhookSecret)
      setStatus('Project created. Issue an API key before wiring the standalone merchant app.')
      router.replace(`/merchant?projectId=${created.project.projectId}`)
    })
  }

  async function handleSelectProject(projectId: string | null) {
    if (!projectId) {
      return
    }

    await runAction('select-project', async () => {
      const nextOverview = await getProjectOverview(projectId, '')
      setSelectedProjectId(projectId)
      setOverview(nextOverview)
      setOneTimeApiKey(null)
      setWebhookSecret(null)
      setStatus('Project loaded.')
      router.replace(`/merchant?projectId=${projectId}`)
    })
  }

  async function handleCreateApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProject) {
      return
    }

    await runAction('create-key', async () => {
      const created = await createProjectApiKey(selectedProject.projectId, {
        environment: selectedProject.defaultEnvironment,
        label: apiKeyLabel,
      })
      setOneTimeApiKey(created.apiKey)
      setStatus('API key created. Store it in the standalone merchant backend environment.')
      await refresh(selectedProject.projectId)
    })
  }

  async function handleConfigureWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProject) {
      return
    }

    await runAction('configure-webhook', async () => {
      const configured = await configureProjectWebhook(selectedProject.projectId, {
        environment: selectedProject.defaultEnvironment,
        url: webhookUrl,
      })
      setWebhookSecret(configured.webhookSecret)
      setStatus('Webhook endpoint created. Use the secret in the standalone merchant backend.')
      await refresh(selectedProject.projectId)
    })
  }

  async function handleTestWebhook(endpointId: string) {
    if (!selectedProject) {
      return
    }

    await runAction(`test-${endpointId}`, async () => {
      await testProjectWebhook(selectedProject.projectId, endpointId)
      setStatus('Webhook test dispatched. Check delivery status below.')
      await refresh(selectedProject.projectId)
    })
  }

  async function handleResend(delivery: WebhookDeliveryRecord) {
    if (!selectedProject) {
      return
    }

    await runAction(`resend-${delivery.deliveryId}`, async () => {
      await resendProjectWebhookDelivery(selectedProject.projectId, delivery.deliveryId)
      setStatus('Webhook delivery resent.')
      await refresh(selectedProject.projectId)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant="secondary">{projects.length}</Badge>
            </CardAction>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Each merchant integration gets its own API keys, checkout sessions, and webhook outbox.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {projects.length > 0 ? (
              <Select items={projects.map((project) => ({ label: project.name, value: project.projectId }))} onValueChange={handleSelectProject} value={selectedProjectId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projects.map((project) => (
                      <SelectItem key={project.projectId} value={project.projectId}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ReceiptTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>No payment project</EmptyTitle>
                  <EmptyDescription>Create one project before connecting CardForge or another merchant backend.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

            <form onSubmit={handleCreateProject}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="project-name">Project name</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <Settings2Icon />
                    </InputGroupAddon>
                    <InputGroupInput id="project-name" onChange={(event) => setProjectName(event.target.value)} value={projectName} />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-environment">Environment</FieldLabel>
                  <Select items={environmentOptions} onValueChange={(value) => setProjectEnvironment(value as ProjectEnvironmentKind)} value={projectEnvironment}>
                    <SelectTrigger className="w-full" id="project-environment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {environmentOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Local dev is deterministic. Sepolia requires funded signer and deployed contract config.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-webhook">Webhook URL</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <BellRingIcon />
                    </InputGroupAddon>
                    <InputGroupInput id="project-webhook" onChange={(event) => setWebhookUrl(event.target.value)} value={webhookUrl} />
                  </InputGroup>
                </Field>
                <Button disabled={busyAction === 'create-project'} type="submit">
                  {busyAction === 'create-project' ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                  Create project
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardAction>
              <Badge variant={selectedEnvironment?.status === 'active' ? 'secondary' : 'outline'}>
                {formatEnvironment(selectedProject?.defaultEnvironment)}
              </Badge>
            </CardAction>
            <CardTitle>{selectedProject?.name ?? 'No project selected'}</CardTitle>
            <CardDescription>
              Owner {compact(ownerAddress)}. Project ID {selectedProject?.projectId ?? 'not created'}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <FactRow label="Signer" value={selectedEnvironment ? 'platform hosted' : 'none'} />
                <FactRow label="Chain ID" value={selectedEnvironment?.chainId?.toString() ?? 'local'} />
                <FactRow label="Settlement" value={compact(selectedEnvironment?.settlementContract ?? null)} />
                <FactRow label="Checkout sessions" value={overview?.summary.totalCheckouts ?? 0} />
                <FactRow label="Pending deliveries" value={overview?.summary.pendingDeliveries ?? 0} />
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>Project loop</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="integration">
        <TabsList variant="line">
          <TabsTrigger value="integration">Integration</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent className="pt-4" value="integration">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card size="sm">
              <CardHeader>
                <CardAction>
                  <Badge variant="outline">{overview?.apiKeys.length ?? 0}</Badge>
                </CardAction>
                <CardTitle>API key</CardTitle>
                <CardDescription>CardForge uses this key server-side. The buyer browser never sends merchant cookies.</CardDescription>
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
                    <Button disabled={!selectedProject || busyAction === 'create-key'} type="submit">
                      {busyAction === 'create-key' ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
                      Generate API key
                    </Button>
                  </FieldGroup>
                </form>

                {oneTimeApiKey ? (
                  <CodeBlock actionLabel="Copy key" onCopy={() => copyText(oneTimeApiKey, setStatus)} value={oneTimeApiKey} />
                ) : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prefix</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead className="text-right">State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview?.apiKeys.map((key) => (
                      <TableRow key={key.keyId}>
                        <TableCell className="font-mono text-xs">{key.prefix}</TableCell>
                        <TableCell>{key.label}</TableCell>
                        <TableCell className="text-right">
                          <StatusBadge value={key.revokedAt ? 'revoked' : 'active'} />
                        </TableCell>
                      </TableRow>
                    )) ?? null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>CardForge environment</CardTitle>
                <CardDescription>Use these values in the standalone demo backend under demo/cardforge.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {selectedProject ? (
                  <CodeBlock actionLabel="Copy env" onCopy={() => copyText(integrationSnippet, setStatus)} value={integrationSnippet} />
                ) : (
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <KeyRoundIcon />
                      </EmptyMedia>
                      <EmptyTitle>Create a project first</EmptyTitle>
                      <EmptyDescription>The integration snippet is generated from project truth.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="pt-4" value="webhooks">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Endpoint</CardTitle>
                <CardDescription>Project-level outbox signs immutable events and records delivery attempts.</CardDescription>
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
                    <Button disabled={!selectedProject || busyAction === 'configure-webhook'} type="submit">
                      {busyAction === 'configure-webhook' ? <Spinner data-icon="inline-start" /> : <BellRingIcon data-icon="inline-start" />}
                      Add endpoint
                    </Button>
                  </FieldGroup>
                </form>
                {webhookSecret ? <CodeBlock actionLabel="Copy secret" onCopy={() => copyText(webhookSecret, setStatus)} value={webhookSecret} /> : null}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardAction>
                  <Badge variant="outline">{overview?.webhookEndpoints.length ?? 0}</Badge>
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
                    {overview?.webhookEndpoints.map((endpoint) => (
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
                    )) ?? null}
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
                    {overview?.webhookDeliveries.map((delivery) => (
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
                    )) ?? null}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="pt-4" value="payments">
          <Card size="sm">
            <CardHeader>
              <CardAction>
                <Badge variant="secondary">{overview?.summary.totalCheckouts ?? 0}</Badge>
              </CardAction>
              <CardTitle>Checkout sessions</CardTitle>
              <CardDescription>External merchant checkout creation returns buyer URLs only after chain invoice authority exists.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Checkout</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Chain invoice</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview?.checkoutSessions.map((session) => (
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
                      <TableCell className="hidden font-mono text-xs md:table-cell">{session.chainInvoiceId}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge value={session.status} />
                      </TableCell>
                    </TableRow>
                  )) ?? null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="pt-4" value="diagnostics">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Open" value={overview?.summary.openCheckouts ?? 0} />
            <MetricCard label="Paid" value={overview?.summary.paidCheckouts ?? 0} />
            <MetricCard label="Webhook backlog" value={overview?.summary.pendingDeliveries ?? 0} />
          </div>
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
                  {overview?.webhookEvents.map((event) => (
                    <TableRow key={event.eventId}>
                      <TableCell>{event.eventType}</TableCell>
                      <TableCell className="max-w-[360px] truncate font-mono text-xs">{event.subjectId}</TableCell>
                      <TableCell className="text-right">{formatTime(event.createdAt)}</TableCell>
                    </TableRow>
                  )) ?? null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CodeBlock({ actionLabel, onCopy, value }: { actionLabel: string; onCopy: () => void; value: string }) {
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

function FactRow({ label, value }: { label: string; value: number | string }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="max-w-[320px] truncate text-right font-medium">{value}</TableCell>
    </TableRow>
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

function StatusBadge({ value }: { value: string }) {
  const variant = ['paid', 'delivered', 'enabled', 'active', 'open'].includes(value)
    ? 'secondary'
    : ['dead_letter', 'failed', 'revoked', 'disabled'].includes(value)
      ? 'destructive'
      : 'outline'

  return <Badge variant={variant}>{value.replaceAll('_', ' ')}</Badge>
}

function formatEnvironment(value: ProjectEnvironmentKind | null | undefined) {
  if (!value) {
    return 'No environment'
  }

  return value === 'sepolia' ? 'Zama Sepolia' : 'Local dev'
}

function compact(value: string | null | undefined) {
  if (!value) {
    return 'none'
  }

  if (value.length <= 16) {
    return value
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: '2-digit',
  }).format(new Date(value))
}

function copyText(value: string, setStatus: (value: string) => void) {
  void navigator.clipboard.writeText(value)
  setStatus('Copied to clipboard.')
}
