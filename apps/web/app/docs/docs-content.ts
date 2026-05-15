import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import Markdoc, { type Config, type RenderableTreeNode } from "@markdoc/markdoc"
import {
  BookOpenIcon,
  BoxesIcon,
  BracesIcon,
  ClipboardCheckIcon,
  KeyRoundIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  TerminalIcon,
  WebhookIcon,
  type LucideIcon,
} from "lucide-react"

export type DocsFigureKind = "project-console" | "api-handoff" | "webhook-outbox" | "cardforge"

export const docsDemoUrl = "https://demo.zamapay.org"

const docsContentRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "docs",
  "content",
  "public",
)

const markdocConfig = {
  tags: {
    callout: {
      attributes: {
        title: { type: String },
        type: { default: "note", type: String },
      },
      render: "Callout",
    },
    figure: {
      attributes: {
        kind: { required: true, type: String },
      },
      render: "GuideFigure",
      selfClosing: true,
    },
  },
} satisfies Config

const iconByKey = {
  "book-open": BookOpenIcon,
  boxes: BoxesIcon,
  braces: BracesIcon,
  clipboard: ClipboardCheckIcon,
  key: KeyRoundIcon,
  receipt: ReceiptTextIcon,
  shield: ShieldCheckIcon,
  terminal: TerminalIcon,
  webhook: WebhookIcon,
} satisfies Record<string, LucideIcon>

type Frontmatter = {
  badge: string
  description: string
  featured: boolean
  group: string
  icon: keyof typeof iconByKey
  order: number
  title: string
}

export type DocsSection = {
  id: string
  title: string
}

export type DocsPage = {
  badge: string
  content: RenderableTreeNode
  description: string
  featured: boolean
  group: string
  iconKey: keyof typeof iconByKey
  icon: LucideIcon
  order: number
  sections: DocsSection[]
  slug: string
  title: string
}

export type DocsGroup = {
  pages: DocsPage[]
  title: string
}

export type DocsEntryPoint = {
  action: string
  description: string
  href: string
  page: DocsPage
  title: string
}

export type DocsTopCategory = DocsGroup & {
  description: string
  href: string
}

export type DocsBrowseSection = {
  description: string
  pages: DocsPage[]
  title: string
}

export type DocsManifestPage = {
  description: string
  group: string
  htmlUrl: string
  markdownUrl: string
  order: number
  sections: DocsSection[]
  slug: string
  title: string
}

export type DocsInstallSurface = {
  agentPageUrl: string
  cliInstallUrl: string
  cliNpmPackage: string
  serverSdkPackage: string
  skillIndexUrl: string
  skillInstallUrl: string
}

export type DocsManifest = {
  generatedAt: string
  install: DocsInstallSurface
  llmsFullUrl: string
  llmsUrl: string
  pages: DocsManifestPage[]
  rules: string[]
  skillUrl: string
}

export type ZamaPayIntegrationManifest = {
  docsManifestUrl: string
  docsUrl: string
  install: DocsInstallSurface
  llmsFullUrl: string
  llmsUrl: string
  name: string
  rules: string[]
  skillUrl: string
  status: {
    cliPrebuiltRelease: "planned"
    serverSdk: "preview"
  }
}

type MarkdocNode = {
  attributes?: Record<string, unknown>
  children?: MarkdocNode[]
  type?: string
}

export const docsPages = loadDocsPages()
export const docsBySlug = new Map(docsPages.map((page) => [page.slug, page]))
export const featuredDocs = docsPages.filter((page) => page.featured)
export const docsGroups = groupDocsPages(docsPages)
export const docsTopCategories = docsGroups.map(toTopCategory)
export const docsEntryPoints = buildDocsEntryPoints()
export const docsBrowseSections = buildDocsBrowseSections()

export const aiIntegrationRules = [
  "Keep ZAMAPAY_SECRET_KEY and webhook whsec_ values on the merchant server only; never expose them to browser code or NEXT_PUBLIC_* variables.",
  "Every checkout create request must pass an explicit paymentRail of zama_private or evm_erc20.",
  "Webhook receivers must verify svix-id, svix-timestamp, and svix-signature against the exact raw request body before JSON parsing.",
  "The evm_erc20 rail and zama_private rail have different payment truth sources; never infer one rail's payment state from the other.",
  "Withdraw, delivery resend, project secret revoke, and webhook secret rotation require explicit human confirmation; agents and scripts must not perform them silently.",
]

function loadDocsPages(): DocsPage[] {
  const files = fs
    .readdirSync(docsContentRoot)
    .filter((file) => file.endsWith(".md"))
    .sort()

  return files.map(loadDocsPage).sort((left, right) => left.order - right.order || left.slug.localeCompare(right.slug))
}

function loadDocsPage(file: string): DocsPage {
  const slug = file.replace(/\.md$/, "")
  const source = fs.readFileSync(path.join(docsContentRoot, file), "utf8")
  const { body, frontmatter } = parseFrontmatter(source, slug)
  const ast = Markdoc.parse(body)
  const errors = Markdoc.validate(ast, markdocConfig)

  if (errors.length > 0) {
    const details = errors.map((error) => `${error.error.message} at line ${error.lines.join("-")}`).join("; ")
    throw new Error(`Invalid docs content ${file}: ${details}`)
  }

  return {
    badge: frontmatter.badge,
    content: Markdoc.transform(ast, markdocConfig),
    description: frontmatter.description,
    featured: frontmatter.featured,
    group: frontmatter.group,
    iconKey: frontmatter.icon,
    icon: iconByKey[frontmatter.icon],
    order: frontmatter.order,
    sections: extractSections(ast as MarkdocNode, file),
    slug,
    title: frontmatter.title,
  }
}

function parseFrontmatter(source: string, slug: string): { body: string; frontmatter: Frontmatter } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) {
    throw new Error(`Docs page ${slug} must start with frontmatter`)
  }

  const values = new Map<string, string | number | boolean>()
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const separator = line.indexOf(":")
    if (separator === -1) {
      throw new Error(`Invalid frontmatter line in ${slug}: ${line}`)
    }

    const key = line.slice(0, separator).trim()
    const value = normalizeFrontmatterValue(line.slice(separator + 1).trim())
    values.set(key, value)
  }

  const frontmatter = {
    badge: readString(values, "badge", slug),
    description: readString(values, "description", slug),
    featured: readBoolean(values, "featured", slug),
    group: readString(values, "group", slug),
    icon: readIcon(values, slug),
    order: readNumber(values, "order", slug),
    title: readString(values, "title", slug),
  }

  return {
    body: source.slice(match[0].length),
    frontmatter,
  }
}

function normalizeFrontmatterValue(value: string): string | number | boolean {
  const unquoted = value.replace(/^["']|["']$/g, "")
  if (unquoted === "true") {
    return true
  }
  if (unquoted === "false") {
    return false
  }
  if (/^\d+$/.test(unquoted)) {
    return Number(unquoted)
  }
  return unquoted
}

function readString(values: Map<string, string | number | boolean>, key: string, slug: string): string {
  const value = values.get(key)
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Docs page ${slug} is missing string frontmatter: ${key}`)
  }
  return value
}

function readNumber(values: Map<string, string | number | boolean>, key: string, slug: string): number {
  const value = values.get(key)
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Docs page ${slug} is missing numeric frontmatter: ${key}`)
  }
  return value
}

function readBoolean(values: Map<string, string | number | boolean>, key: string, slug: string): boolean {
  const value = values.get(key)
  if (typeof value !== "boolean") {
    throw new Error(`Docs page ${slug} is missing boolean frontmatter: ${key}`)
  }
  return value
}

function readIcon(values: Map<string, string | number | boolean>, slug: string): keyof typeof iconByKey {
  const icon = readString(values, "icon", slug)
  if (!(icon in iconByKey)) {
    throw new Error(`Docs page ${slug} uses unknown icon: ${icon}`)
  }
  return icon as keyof typeof iconByKey
}

function extractSections(node: MarkdocNode, file: string): DocsSection[] {
  const sections: DocsSection[] = []
  visit(node, (candidate) => {
    if (candidate.type !== "heading" || candidate.attributes?.level !== 2) {
      return
    }

    const title = textContent(candidate).trim()
    const id = typeof candidate.attributes.id === "string" ? candidate.attributes.id : slugify(title)
    if (!id || !title) {
      throw new Error(`Docs page ${file} has an invalid level-two heading`)
    }

    sections.push({ id, title })
  })

  assertUniqueSections(sections, file)
  return sections
}

function visit(node: MarkdocNode, callback: (node: MarkdocNode) => void): void {
  callback(node)
  for (const child of node.children ?? []) {
    visit(child, callback)
  }
}

function textContent(node: MarkdocNode): string {
  if (typeof node.attributes?.content === "string") {
    return node.attributes.content
  }
  return (node.children ?? []).map(textContent).join("")
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function assertUniqueSections(sections: DocsSection[], file: string): void {
  const seen = new Set<string>()
  for (const section of sections) {
    if (seen.has(section.id)) {
      throw new Error(`Docs page ${file} has duplicate section id: ${section.id}`)
    }
    seen.add(section.id)
  }
}

function groupDocsPages(pages: DocsPage[]): DocsGroup[] {
  const groups: DocsGroup[] = []
  const byTitle = new Map<string, DocsGroup>()

  for (const page of pages) {
    const group = byTitle.get(page.group) ?? { pages: [], title: page.group }
    group.pages.push(page)

    if (!byTitle.has(page.group)) {
      byTitle.set(page.group, group)
      groups.push(group)
    }
  }

  return groups
}

function toTopCategory(group: DocsGroup): DocsTopCategory {
  return {
    ...group,
    description: groupDescription(group.title),
    href: `/docs#${slugify(group.title)}`,
  }
}

function groupDescription(title: string): string {
  if (title === "Start") {
    return "Project setup, local workflow, and the shortest correct path."
  }
  if (title === "Build") {
    return "SDKs, raw HTTP, payment rails, API contracts, and private checkout."
  }
  if (title === "Operate") {
    return "Webhook delivery, environments, finality, and deployment workflow."
  }
  if (title === "Examples") {
    return "Small merchant integration examples and the CardForge demo."
  }
  return "Documentation grouped by integration area."
}

function buildDocsEntryPoints(): DocsEntryPoint[] {
  return [
    {
      action: "Start here",
      description: "Create a project, keep one server-side secret, and redirect buyers to hosted checkout.",
      page: pageBySlug("quickstart"),
      title: "Accept a hosted payment",
    },
    {
      action: "Install tools",
      description: "Install the CLI, server SDK preview, and ZamaPay agent skill from one place.",
      page: pageBySlug("install"),
      title: "Set up CLI and agents",
    },
    {
      action: "Use the SDK",
      description: "Call ZamaPay from a merchant backend with explicit rail selection and project-secret auth.",
      page: pageBySlug("server-sdk-preview"),
      title: "Integrate server-side",
    },
    {
      action: "Choose rails",
      description: "Separate ordinary ERC20 settlement from the Zama private payment path.",
      page: pageBySlug("payment-rails"),
      title: "Route payments correctly",
    },
    {
      action: "Verify events",
      description: "Handle Svix-style signed webhooks from raw bytes before parsing JSON.",
      page: pageBySlug("webhooks"),
      title: "Confirm payment outcomes",
    },
    {
      action: "Run locally",
      description: "Use the Justfile workflow for local services, SDK smoke tests, and full verification.",
      page: pageBySlug("development"),
      title: "Set up development",
    },
    {
      action: "Copy a pattern",
      description: "Start from checkout creation, webhook receiver, and redirect handoff examples.",
      page: pageBySlug("examples"),
      title: "Use examples",
    },
  ].map((entry) => ({
    ...entry,
    href: `/docs/${entry.page.slug}`,
  }))
}

function buildDocsBrowseSections(): DocsBrowseSection[] {
  return [
    {
      description: "Hosted checkout, ordinary ERC20 settlement, and Zama private checkout boundaries.",
      pages: pagesBySlug(["quickstart", "payment-rails", "private-checkout-v1"]),
      title: "Payments",
    },
    {
      description: "Server SDK, raw HTTP fallback, merchant API contracts, and local workflow.",
      pages: pagesBySlug(["install", "server-sdk-preview", "raw-http-fallback", "api-reference", "development"]),
      title: "Developer tools",
    },
    {
      description: "Webhook delivery, runtime environments, finality gates, and deployment profiles.",
      pages: pagesBySlug(["webhooks", "environments"]),
      title: "Operations",
    },
    {
      description: "End-to-end merchant examples and CardForge as the raw HTTP baseline.",
      pages: pagesBySlug(["examples", "cardforge"]),
      title: "Examples",
    },
  ]
}

function pageBySlug(slug: string): DocsPage {
  const page = docsBySlug.get(slug)
  if (!page) {
    throw new Error(`Docs page does not exist: ${slug}`)
  }
  return page
}

function pagesBySlug(slugs: string[]): DocsPage[] {
  return slugs.map(pageBySlug)
}

export function buildLlmsTxt(baseUrl: string): string {
  const origin = cleanBaseUrl(baseUrl)
  const lines = [
    "# ZamaPay",
    "",
    "ZamaPay is a hosted merchant checkout platform for ordinary EVM ERC20 settlement and Zama-backed private payment rails.",
    "",
    "Use these AI-readable docs when integrating ZamaPay into a merchant backend, coding agent workflow, or test project.",
    "",
    "## Integration rules",
    ...aiIntegrationRules.map((rule) => `- ${rule}`),
    "",
    "## Core docs",
    ...docsPages.map((page) => `- [${page.title}](${origin}/docs/${page.slug}.md): ${page.description}`),
    "",
    "## Machine-readable index",
    `- [Docs manifest](${origin}/docs/manifest.json)`,
    `- [Integration manifest](${origin}/.well-known/zamapay.json)`,
    `- [Full docs corpus](${origin}/llms-full.txt)`,
    `- [ZamaPay Skill](${origin}/.well-known/skills/zamapay)`,
    `- [ZamaPay skill installer](${origin}/.well-known/skills/zamapay/install.sh)`,
    `- [ZamaPay CLI installer](${origin}/install.sh)`,
    "",
  ]
  return `${lines.join("\n")}\n`
}

export function buildLlmsFullTxt(baseUrl: string): string {
  const origin = cleanBaseUrl(baseUrl)
  const pages = docsPages.map((page) => markdownForDocsPage(page.slug, origin).trim()).join("\n\n---\n\n")
  return `${buildLlmsTxt(origin).trim()}\n\n---\n\n${pages}\n`
}

export function buildDocsManifest(baseUrl: string): DocsManifest {
  const origin = cleanBaseUrl(baseUrl)
  return {
    generatedAt: "static",
    install: buildInstallSurface(origin),
    llmsFullUrl: `${origin}/llms-full.txt`,
    llmsUrl: `${origin}/llms.txt`,
    pages: docsPages.map((page) => ({
      description: page.description,
      group: page.group,
      htmlUrl: `${origin}/docs/${page.slug}`,
      markdownUrl: `${origin}/docs/${page.slug}.md`,
      order: page.order,
      sections: page.sections,
      slug: page.slug,
      title: page.title,
    })),
    rules: aiIntegrationRules,
    skillUrl: `${origin}/.well-known/skills/zamapay`,
  }
}

export function buildInstallSurface(baseUrl: string): DocsInstallSurface {
  const origin = cleanBaseUrl(baseUrl)
  return {
    agentPageUrl: `${origin}/agents`,
    cliInstallUrl: `${origin}/install.sh`,
    cliNpmPackage: "@zamapay/cli",
    serverSdkPackage: "@zamapay/server",
    skillIndexUrl: `${origin}/.well-known/skills/index.json`,
    skillInstallUrl: `${origin}/.well-known/skills/zamapay/install.sh`,
  }
}

export function buildIntegrationManifest(baseUrl: string): ZamaPayIntegrationManifest {
  const origin = cleanBaseUrl(baseUrl)
  return {
    docsManifestUrl: `${origin}/docs/manifest.json`,
    docsUrl: `${origin}/docs`,
    install: buildInstallSurface(origin),
    llmsFullUrl: `${origin}/llms-full.txt`,
    llmsUrl: `${origin}/llms.txt`,
    name: "ZamaPay",
    rules: aiIntegrationRules,
    skillUrl: `${origin}/.well-known/skills/zamapay`,
    status: {
      cliPrebuiltRelease: "planned",
      serverSdk: "preview",
    },
  }
}

export function markdownForDocsPage(slug: string, baseUrl: string): string {
  const page = pageBySlug(slug)
  const origin = cleanBaseUrl(baseUrl)
  const source = fs.readFileSync(path.join(docsContentRoot, `${page.slug}.md`), "utf8")
  const { body } = parseFrontmatter(source, page.slug)
  const normalizedBody = normalizeAiMarkdown(body).trim()
  return [
    `# ${page.title}`,
    "",
    page.description,
    "",
    `Canonical: ${origin}/docs/${page.slug}`,
    `Markdown: ${origin}/docs/${page.slug}.md`,
    "",
    normalizedBody,
    "",
  ].join("\n")
}

export function docsMarkdownSlugs(): { slug: string }[] {
  return docsPages.map((page) => ({ slug: page.slug }))
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function normalizeAiMarkdown(markdown: string): string {
  return markdown
    .replace(/\s+\{%\s+#([a-zA-Z0-9_-]+)\s+%\}/g, "")
    .replace(/\{% figure kind="([^"]+)" \/%\}/g, "> Figure: $1.")
    .replace(/\{% callout title="([^"]+)" type="([^"]+)" %\}/g, "> $2: $1")
    .replace(/\{% callout title="([^"]+)" %\}/g, "> Note: $1")
    .replace(/\{% \/callout %\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
}
