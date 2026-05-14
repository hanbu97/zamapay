'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  BellRingIcon,
  CheckCircle2Icon,
  CircleCheckIcon,
  CirclePauseIcon,
  EllipsisVerticalIcon,
  Grid2X2Icon,
  KeyRoundIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { createPaymentProject, createProjectSecret, type PaymentProject } from '@/lib/api'
import { contractEnvironmentConfig, publicContractEnvironment } from '@/lib/contract-environment'
import { OneTimeSecretDialog, buildIntegrationBundle, formatEnvironment, type OneTimeSecret } from './PaymentProjectConsoleParts'

type MerchantProjectsOverviewProps = {
  initialProjects: PaymentProject[]
}

type ProjectFilter = 'all' | 'active' | 'disabled'
type ProjectSort = 'name' | 'newest'
type ProjectView = 'grid' | 'list'

const defaultProjectEnvironment = contractEnvironmentConfig(publicContractEnvironment()).projectEnvironment

const statusOptions: Array<{ label: string; value: ProjectFilter }> = [
  { label: 'All status', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Disabled', value: 'disabled' },
]

const sortOptions: Array<{ label: string; value: ProjectSort }> = [
  { label: 'Sorted by name', value: 'name' },
  { label: 'Newest first', value: 'newest' },
]
const defaultProjectWebhookUrl =
  process.env.NEXT_PUBLIC_DEFAULT_PROJECT_WEBHOOK_URL ?? 'http://127.0.0.1:8092/api/zamapay/webhook'

export function MerchantProjectsOverview({ initialProjects }: MerchantProjectsOverviewProps) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectFilter>('all')
  const [sort, setSort] = useState<ProjectSort>('name')
  const [view, setView] = useState<ProjectView>('grid')
  const [createOpen, setCreateOpen] = useState(false)
  const [projectName, setProjectName] = useState('Online store')
  const [webhookUrl, setWebhookUrl] = useState(defaultProjectWebhookUrl)
  const [secretLabel, setSecretLabel] = useState('Merchant backend')
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecret | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = projects.filter((project) => {
      const matchesQuery =
        !normalizedQuery ||
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.projectId.toLowerCase().includes(normalizedQuery)
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter

      return matchesQuery && matchesStatus
    })

    return filtered.sort((left, right) => {
      if (sort === 'newest') {
        return Date.parse(right.createdAt) - Date.parse(left.createdAt)
      }

      return left.name.localeCompare(right.name)
    })
  }, [projects, query, sort, statusFilter])

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
        environment: defaultProjectEnvironment,
        name: projectName,
        webhookUrl: webhookUrl.trim() ? webhookUrl : undefined,
      })
      const projectSecret = await createProjectSecret(created.project.projectId, {
        environment: created.project.defaultEnvironment,
        label: secretLabel,
      })
      setProjects((current) => [created.project, ...current.filter((project) => project.projectId !== created.project.projectId)])
      setCreateOpen(false)
      setStatus('Project created. Copy the project secret key, then open the project.')
      revealOneTimeSecret({
        copyLabel: 'Shell export',
        description: 'This secret key is shown once. Use it only on the merchant backend; CardForge will bootstrap project and webhook context from ZamaPay.',
        title: 'Copy project secret key',
        value: buildIntegrationBundle({
          secretKey: projectSecret.secretKey,
        }),
      })
      router.refresh()
    })
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
          <AlertTitle>Projects</AlertTitle>
          <AlertDescription>{status}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <InputGroup className="md:max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput aria-label="Search projects" onChange={(event) => setQuery(event.target.value)} placeholder="Search for a project" value={query} />
            </InputGroup>
            <Select items={statusOptions} onValueChange={(value) => setStatusFilter(value as ProjectFilter)} value={statusFilter}>
              <SelectTrigger className="w-full md:w-36">
                <SlidersHorizontalIcon />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {statusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select items={sortOptions} onValueChange={(value) => setSort(value as ProjectSort)} value={sort}>
              <SelectTrigger className="w-full md:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden rounded-md border bg-background p-0.5 md:flex">
              <Button aria-label="Grid view" onClick={() => setView('grid')} size="icon-sm" type="button" variant={view === 'grid' ? 'secondary' : 'ghost'}>
                <Grid2X2Icon />
              </Button>
              <Button aria-label="List view" onClick={() => setView('list')} size="icon-sm" type="button" variant={view === 'list' ? 'secondary' : 'ghost'}>
                <ListIcon />
              </Button>
            </div>
            <CreateProjectDialog
              secretLabel={secretLabel}
              busy={busyAction === 'create-project'}
              createOpen={createOpen}
              onCreateOpenChange={setCreateOpen}
              onProjectNameChange={setProjectName}
              onSecretLabelChange={setSecretLabel}
              onSubmit={handleCreateProject}
              onWebhookUrlChange={setWebhookUrl}
              projectName={projectName}
              webhookUrl={webhookUrl}
            />
          </div>
        </div>

        {visibleProjects.length > 0 ? (
          <div className={view === 'grid' ? 'grid gap-4 lg:grid-cols-2 2xl:grid-cols-3' : 'grid gap-3'}>
            {visibleProjects.map((project) => (
              <ProjectCard key={project.projectId} project={project} view={view} />
            ))}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Grid2X2Icon />
              </EmptyMedia>
              <EmptyTitle>No matching projects</EmptyTitle>
              <EmptyDescription>Create a project or clear the filters.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}

function CreateProjectDialog({
  busy,
  createOpen,
  onCreateOpenChange,
  onProjectNameChange,
  onSecretLabelChange,
  onSubmit,
  onWebhookUrlChange,
  projectName,
  secretLabel,
  webhookUrl,
}: {
  busy: boolean
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
  onProjectNameChange: (value: string) => void
  onSecretLabelChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  onWebhookUrlChange: (value: string) => void
  projectName: string
  secretLabel: string
  webhookUrl: string
}) {
  return (
    <Dialog onOpenChange={onCreateOpenChange} open={createOpen}>
      <DialogTrigger render={<Button className="shrink-0" size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        New project
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create payment project</DialogTitle>
          <DialogDescription>Projects isolate server secrets, webhook outboxes, and checkout sessions.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Settings2Icon />
                </InputGroupAddon>
                <InputGroupInput id="project-name" onChange={(event) => onProjectNameChange(event.target.value)} value={projectName} />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-webhook">Webhook URL</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <BellRingIcon />
                </InputGroupAddon>
                <InputGroupInput id="project-webhook" onChange={(event) => onWebhookUrlChange(event.target.value)} value={webhookUrl} />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="project-key-label">Secret key label</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <KeyRoundIcon />
                </InputGroupAddon>
                <InputGroupInput id="project-key-label" onChange={(event) => onSecretLabelChange(event.target.value)} value={secretLabel} />
              </InputGroup>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={busy} type="submit">
              {busy ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectCard({ project, view }: { project: PaymentProject; view: ProjectView }) {
  const isActive = project.status === 'active'
  const StatusIcon = isActive ? CircleCheckIcon : CirclePauseIcon

  return (
    <Link className="group block focus-visible:outline-none" href={`/merchant/${project.projectId}`}>
      <Card
        className={`transition-colors group-hover:bg-muted/20 group-focus-visible:ring-2 group-focus-visible:ring-ring ${
          view === 'grid' ? 'min-h-48' : 'min-h-28'
        }`}
        size="sm"
      >
        <CardHeader>
          <CardAction>
            <EllipsisVerticalIcon className="text-muted-foreground" />
          </CardAction>
          <CardTitle>{project.name}</CardTitle>
          <CardDescription>
            {formatEnvironment(project.defaultEnvironment)} | {project.status}
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-auto flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
              <StatusIcon className="size-4" />
            </span>
            <span className="truncate text-sm font-medium">Project is {isActive ? 'active' : 'paused'}</span>
          </div>
          <Badge className="shrink-0" variant={isActive ? 'secondary' : 'outline'}>
            {project.defaultEnvironment}
          </Badge>
        </CardContent>
      </Card>
    </Link>
  )
}
