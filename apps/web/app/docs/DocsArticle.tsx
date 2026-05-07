import Image from "next/image"
import Link from "next/link"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  StoreIcon,
  WebhookIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import type { DocsFigureKind, DocsPage, DocsSection } from "./docs-content"
import { docsPages } from "./docs-content"

export function DocsArticle({ page }: { page: DocsPage }) {
  const Icon = page.icon

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 md:px-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Documentation</div>
          {docsPages.map((item) => (
            <Button
              className="justify-start"
              key={item.slug}
              nativeButton={false}
              render={<Link href={`/docs/${item.slug}`} />}
              size="sm"
              variant={item.slug === page.slug ? "secondary" : "ghost"}
            >
              <item.icon data-icon="inline-start" />
              {item.title}
            </Button>
          ))}
        </div>
      </aside>

      <article className="min-w-0">
        <div className="flex flex-col gap-5 border-b pb-8">
          <Badge className="w-fit" variant="secondary">
            <Icon data-icon="inline-start" />
            {page.badge}
          </Badge>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-4xl font-semibold leading-tight tracking-normal text-balance md:text-6xl">{page.title}</h1>
            <p className="text-lg leading-8 text-muted-foreground">{page.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {page.sections.map((section) => (
              <Button key={section.id} nativeButton={false} render={<a href={`#${section.id}`} />} size="sm" variant="outline">
                {section.title}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-10 py-10">
          {page.sections.map((section) => (
            <DocsSectionBlock key={section.id} section={section} />
          ))}
        </div>

        <Separator />

        <div className="flex flex-col items-start justify-between gap-4 py-8 md:flex-row md:items-center">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-normal">Ready to wire a merchant project?</h2>
            <p className="mt-2 text-muted-foreground">
              Create the project in the console, then keep external checkout creation on the project API-key path.
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/merchant" />} size="lg">
            Open console
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </article>
    </div>
  )
}

function DocsSectionBlock({ section }: { section: DocsSection }) {
  return (
    <section className="scroll-mt-24" id={section.id}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.88fr)_minmax(18rem,0.62fr)]">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-normal">{section.title}</h2>
          <div className="mt-3 flex flex-col gap-3 text-base leading-7 text-muted-foreground">
            {section.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          {section.steps ? <StepList steps={section.steps} /> : null}
          {section.table ? <DocsTable section={section} /> : null}
          {section.code ? (
            <pre className="mt-5 max-w-full overflow-x-auto rounded-lg border bg-muted p-4 text-xs leading-6 text-muted-foreground">
              <code>{section.code}</code>
            </pre>
          ) : null}
        </div>
        <GuideFigure kind={section.figure} />
      </div>
    </section>
  )
}

function StepList({ steps }: { steps: NonNullable<DocsSection["steps"]> }) {
  return (
    <div className="mt-5 grid gap-3">
      {steps.map((step, index) => (
        <div className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[2.5rem_1fr]" key={step.title}>
          <Badge className="w-fit" variant="outline">
            {String(index + 1).padStart(2, "0")}
          </Badge>
          <div className="min-w-0">
            <div className="font-medium">{step.title}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function DocsTable({ section }: { section: DocsSection }) {
  if (!section.table) {
    return null
  }

  return (
    <div className="mt-5 overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {section.table.headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.table.rows.map((row) => (
            <TableRow key={row.join(":")}>
              {row.map((cell) => (
                <TableCell className="max-w-[22rem] whitespace-normal leading-6" key={cell}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function GuideFigure({ kind }: { kind?: DocsFigureKind }) {
  if (!kind) {
    return (
      <Alert>
        <ShieldCheckIcon />
        <AlertTitle>Invariant</AlertTitle>
        <AlertDescription>
          Checkout state belongs to Mermer Pay. Merchant apps receive a hosted URL and signed callback events.
        </AlertDescription>
      </Alert>
    )
  }

  if (kind === "project-console") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Operation guide</CardTitle>
          <CardDescription>Create project, API key, webhook, then hand configuration to the merchant backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
            <Image
              alt="Mermer Pay merchant console showing project integration configuration"
              className="object-cover object-top"
              fill
              sizes="(min-width: 1024px) 420px, 100vw"
              src="/landing/merchant-console.png"
            />
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <FigureRow label="Project" value="proj_..." />
            <FigureRow label="Key prefix" value="mmp_test_..." />
            <FigureRow label="Webhook" value="enabled" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (kind === "api-handoff") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backend handoff</CardTitle>
          <CardDescription>Only the merchant backend sees the project API key.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <FlowNode icon={StoreIcon} label="Merchant app" value="Order intent" />
            <FlowArrow />
            <FlowNode icon={KeyRoundIcon} label="Merchant backend" value="Bearer mmp_test_..." />
            <FlowArrow />
            <FlowNode icon={ReceiptTextIcon} label="Mermer Pay" value="Hosted checkout URL" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (kind === "webhook-outbox") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Outbox diagnostics</CardTitle>
          <CardDescription>Immutable event, delivery attempt, result, and manual resend stay separate.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <FigureRow label="Event" value="payment.finality_safe" />
            <FigureRow label="Delivery" value="attempt 1 / delivered" />
            <FigureRow label="Signature" value="keccak256.secret_prefix.v1" />
            <FigureRow label="Retry" value="manual resend available" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CardForge boundary</CardTitle>
        <CardDescription>Standalone demo template consumes Mermer Pay configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LockKeyholeIcon />
            No Mermer cookie forwarding
          </div>
          <Separator className="my-3" />
          <div className="grid gap-2 text-sm">
            <FigureRow label="Frontend" value="CardForge storefront" />
            <FigureRow label="Backend" value="POST /api/orders/checkout" />
            <FigureRow label="Mermer API" value="/api/projects/{id}/checkout-sessions" />
            <FigureRow label="Webhook" value="/api/mermer-pay/webhook" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FigureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

function FlowNode({ icon: Icon, label, value }: { icon: typeof StoreIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon />
        {label}
      </div>
      <div className="mt-2 text-sm text-muted-foreground">{value}</div>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="flex items-center justify-center text-muted-foreground">
      <ArrowRightIcon />
    </div>
  )
}
