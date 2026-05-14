import React, { type ComponentPropsWithoutRef, type ReactNode } from "react"
import Image from "next/image"
import Link from "next/link"
import Markdoc from "@markdoc/markdoc"
import {
  ArrowRightIcon,
  InfoIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  StoreIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { CodeBlock } from "./CodeBlock"
import type { DocsFigureKind, DocsPage } from "./docs-content"
import { docsGroups } from "./docs-content"
import { resolveDocsTagName } from "./markdoc-rendering"
import { MermaidDiagram } from "./MermaidDiagram"

const markdocComponents = {
  Callout,
  GuideFigure,
  a: DocsLink,
  article: DocsContent,
  code: InlineCode,
  h2: DocsHeading2,
  h3: DocsHeading3,
  li: DocsListItem,
  ol: DocsOrderedList,
  p: DocsParagraph,
  pre: DocsPre,
  table: DocsMarkdownTable,
  tbody: TableBody,
  td: DocsTableCell,
  th: DocsTableHead,
  thead: TableHeader,
  tr: TableRow,
  ul: DocsUnorderedList,
}

export function DocsArticle({ page }: { page: DocsPage }) {
  const Icon = page.icon
  const content = Markdoc.renderers.react(page.content, React, {
    components: markdocComponents,
    resolveTagName: resolveDocsTagName,
  })

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 md:px-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-5">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Documentation</div>
          {docsGroups.map((group) => (
            <div className="grid gap-1" key={group.title}>
              <div className="px-2 text-[0.68rem] font-medium uppercase tracking-normal text-muted-foreground">
                {group.title}
              </div>
              {group.pages.map((item) => (
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

        {content}

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

function DocsContent({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-10 py-10">{children}</div>
}

function DocsHeading2({ children, id }: ComponentPropsWithoutRef<"h2">) {
  return (
    <h2 className="scroll-mt-24 text-2xl font-semibold tracking-normal" id={id}>
      {children}
    </h2>
  )
}

function DocsHeading3({ children, id }: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3 className="scroll-mt-24 pt-2 text-lg font-semibold tracking-normal" id={id}>
      {children}
    </h3>
  )
}

function DocsParagraph({ children }: { children: ReactNode }) {
  return <p className="max-w-3xl text-base leading-7 text-muted-foreground">{children}</p>
}

function DocsUnorderedList({ children }: { children: ReactNode }) {
  return <ul className="grid max-w-3xl list-disc gap-2 pl-6 text-base leading-7 text-muted-foreground">{children}</ul>
}

function DocsOrderedList({ children }: { children: ReactNode }) {
  return <ol className="grid max-w-3xl list-decimal gap-3 pl-6 text-base leading-7 text-muted-foreground">{children}</ol>
}

function DocsListItem({ children }: { children: ReactNode }) {
  return <li className="pl-1">{children}</li>
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[0.88em] text-foreground">{children}</code>
}

function DocsLink({ children, href }: ComponentPropsWithoutRef<"a">) {
  if (!href) {
    return <span>{children}</span>
  }

  const className = "font-medium text-foreground underline underline-offset-4 hover:text-primary"

  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link className={className} href={href}>
        {children}
      </Link>
    )
  }

  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  )
}

type DocsPreProps = ComponentPropsWithoutRef<"pre"> & {
  "data-language"?: string
}

function DocsPre({ children, "data-language": dataLanguage }: DocsPreProps) {
  const content = String(children ?? "")
  const language = typeof dataLanguage === "string" ? dataLanguage : undefined

  if (language === "mermaid") {
    return <MermaidDiagram chart={content.trim()} />
  }

  return <CodeBlock code={content} language={language} />
}

function DocsMarkdownTable({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border">
      <Table>{children}</Table>
    </div>
  )
}

function DocsTableHead({ children }: { children: ReactNode }) {
  return <TableHead>{children}</TableHead>
}

function DocsTableCell({ children }: { children: ReactNode }) {
  return <TableCell className="max-w-[24rem] whitespace-normal align-top leading-6">{children}</TableCell>
}

function Callout({ children, title, type = "note" }: { children: ReactNode; title?: string; type?: string }) {
  const isWarning = type === "warning"

  return (
    <div className="max-w-3xl rounded-lg border bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-background">
          {isWarning ? <ShieldCheckIcon className="size-4" /> : <InfoIcon className="size-4" />}
        </div>
        <div className="min-w-0">
          {title ? <div className="font-medium">{title}</div> : null}
          <div className="mt-1 grid gap-2 text-sm leading-6 text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  )
}

function GuideFigure({ kind }: { kind?: DocsFigureKind }) {
  if (kind === "project-console") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Operation guide</CardTitle>
          <CardDescription>Create project, secret key, webhook, then hand configuration to the merchant backend.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
            <Image
              alt="ZamaPay merchant console showing project integration configuration"
              className="object-cover object-top"
              fill
              sizes="(min-width: 1024px) 420px, 100vw"
              src="/landing/merchant-console.png"
            />
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <FigureRow label="Project" value="proj_..." />
            <FigureRow label="Key prefix" value="zms_test_..." />
            <FigureRow label="Webhook" value="bootstrapped" />
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
          <CardDescription>Only the merchant backend sees the project secret key.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <FlowNode icon={StoreIcon} label="Merchant app" value="Order intent" />
            <FlowArrow />
            <FlowNode icon={KeyRoundIcon} label="Merchant backend" value="Bearer zms_test_..." />
            <FlowArrow />
            <FlowNode icon={ReceiptTextIcon} label="ZamaPay" value="Hosted checkout URL" />
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
            <FigureRow label="Signature" value="svix v1 HMAC-SHA256" />
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
        <CardDescription>Standalone demo template consumes ZamaPay configuration.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LockKeyholeIcon />
            No ZamaPay cookie forwarding
          </div>
          <Separator className="my-3" />
          <div className="grid gap-2 text-sm">
            <FigureRow label="Frontend" value="CardForge storefront" />
            <FigureRow label="Backend" value="POST /api/orders/checkout" />
            <FigureRow label="ZamaPay API" value="/api/projects/{id}/checkout-sessions" />
            <FigureRow label="Webhook" value="/api/zamapay/webhook" />
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
