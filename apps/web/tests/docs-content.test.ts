import assert from 'node:assert/strict'
import test from 'node:test'

import { highlightCode } from '../app/docs/code-highlighting.ts'
import {
  aiIntegrationRules,
  buildDocsManifest,
  buildIntegrationManifest,
  buildLlmsFullTxt,
  buildLlmsTxt,
  docsBrowseSections,
  docsBySlug,
  docsEntryPoints,
  docsGroups,
  docsMarkdownSlugs,
  docsPages,
  docsTopCategories,
  featuredDocs,
  markdownForDocsPage,
} from '../app/docs/docs-content.ts'
import { buildCliInstallScript, buildSkillInstallScript } from '../app/install-scripts.ts'
import { resolveDocsTagName } from '../app/docs/markdoc-rendering.ts'
import { requestOrigin } from '../app/docs/request-origin.ts'

test('public docs load from Markdoc files with stable route metadata', () => {
  assert.ok(docsPages.length >= 10)
  assert.equal(docsPages[0].slug, 'quickstart')
  assert.ok(docsBySlug.has('development'))
  assert.ok(docsBySlug.has('install'))
  assert.ok(docsBySlug.has('webhooks'))
  assert.ok(featuredDocs.length >= 4)
  assert.ok(docsGroups.some((group) => group.title === 'Build'))
  assert.ok(docsTopCategories.some((category) => category.href === '/docs#build'))
  assert.ok(docsEntryPoints.some((entry) => entry.page.slug === 'quickstart'))
  assert.ok(docsBrowseSections.some((section) => section.title === 'Payments'))
})

test('public docs keep unique slugs, order, and section anchors', () => {
  assert.equal(new Set(docsPages.map((page) => page.slug)).size, docsPages.length)
  assert.equal(new Set(docsPages.map((page) => page.order)).size, docsPages.length)

  for (const page of docsPages) {
    assert.ok(page.sections.length > 0, `${page.slug} must expose h2 sections`)
    assert.equal(new Set(page.sections.map((section) => section.id)).size, page.sections.length)
  }
})

test('public docs homepage navigation is grouped by task and capability', () => {
  assert.equal(docsEntryPoints[0]?.page.slug, 'quickstart')
  assert.deepEqual(
    docsTopCategories.map((category) => category.title),
    ['Start', 'Build', 'Operate', 'Examples'],
  )
  assert.deepEqual(
    docsBrowseSections.map((section) => section.title),
    ['Payments', 'Developer tools', 'Operations', 'Examples'],
  )

  for (const entry of docsEntryPoints) {
    assert.ok(entry.href.startsWith('/docs/'))
    assert.ok(entry.title)
    assert.ok(entry.description)
  }
})

test('public docs preserve fenced code blocks for styled rendering', () => {
  const page = docsBySlug.get('development')
  assert.ok(page)

  const preNodes = collectTagNames(page.content).filter((node) => node.name === 'pre')
  assert.ok(preNodes.some((node) => node.language === 'bash'), 'development docs must keep bash fences as pre nodes')
  assert.ok(
    preNodes.some((node) => String(node.content).includes('just docs-check')),
    'development docs must keep fence content intact',
  )
})

test('docs Markdoc renderer maps lowercase HTML tags to local components', () => {
  const Paragraph = () => null
  const Pre = () => null
  const Callout = () => null
  const components = {
    Callout,
    p: Paragraph,
    pre: Pre,
  }

  assert.equal(resolveDocsTagName('p', components), Paragraph)
  assert.equal(resolveDocsTagName('pre', components), Pre)
  assert.equal(resolveDocsTagName('Callout', components), Callout)
  assert.equal(resolveDocsTagName('section', components), 'section')
})

test('docs code highlighter recognizes common integration snippets', () => {
  const bash = highlightCode('# Terminal 0\njust db-up', 'bash')
  const http = highlightCode('ZamaPay-Version: 2026-05-14', 'http')
  const json = highlightCode('{"paymentRail":"evm_erc20","amount":120}', 'json')

  assert.equal(bash[0][0]?.kind, 'comment')
  assert.ok(bash[1].some((token) => token.kind === 'command' && token.value === 'just'))
  assert.ok(http[0].some((token) => token.kind === 'property' && token.value === 'ZamaPay-Version'))
  assert.ok(json[0].some((token) => token.kind === 'property' && token.value === '"paymentRail"'))
  assert.ok(json[0].some((token) => token.kind === 'number' && token.value === '120'))
})

test('AI-readable docs expose llms index, full corpus, per-page markdown, and manifest', () => {
  const baseUrl = 'https://docs.example.test'
  const llms = buildLlmsTxt(baseUrl)
  const full = buildLlmsFullTxt(baseUrl)
  const manifest = buildDocsManifest(baseUrl)
  const integrationManifest = buildIntegrationManifest(baseUrl)
  const quickstart = markdownForDocsPage('quickstart', baseUrl)

  assert.ok(llms.includes('/llms-full.txt'))
  assert.ok(llms.includes('/docs/quickstart.md'))
  assert.ok(llms.includes('/install.sh'))
  assert.ok(llms.includes('/.well-known/zamapay.json'))
  assert.ok(full.includes('# Quickstart'))
  assert.ok(full.includes('# Webhooks'))
  assert.ok(full.includes('# Install ZamaPay'))
  assert.ok(quickstart.startsWith('# Quickstart'))
  assert.equal(quickstart.includes('---\ntitle:'), false)
  assert.equal(quickstart.includes('{% callout'), false)
  assert.equal(quickstart.includes('{% figure'), false)
  assert.equal(manifest.pages.length, docsPages.length)
  assert.deepEqual(
    manifest.rules,
    aiIntegrationRules,
    'manifest rules must match the agent-facing integration guardrails',
  )
  assert.equal(manifest.install.serverSdkPackage, '@zamapay/server')
  assert.equal(manifest.install.cliNpmPackage, '@zamapay/cli')
  assert.equal(manifest.install.skillInstallUrl, `${baseUrl}/.well-known/skills/zamapay/install.sh`)
  assert.equal(integrationManifest.install.cliInstallUrl, `${baseUrl}/install.sh`)
  assert.equal(integrationManifest.status.cliPrebuiltRelease, 'planned')
  assert.deepEqual(docsMarkdownSlugs().map((entry) => entry.slug), docsPages.map((page) => page.slug))
})

test('install scripts expose preview-safe CLI and skill setup paths', () => {
  const cliScript = buildCliInstallScript('https://docs.example.test/')
  const skillScript = buildSkillInstallScript('https://docs.example.test/')

  assert.ok(cliScript.includes('--from-source'))
  assert.ok(cliScript.includes('Prebuilt ZamaPay CLI releases are not published yet.'))
  assert.ok(cliScript.includes('/.well-known/skills/zamapay/install.sh'))
  assert.ok(skillScript.includes('${CODEX_HOME:-${HOME}/.codex}/skills/zamapay'))
  assert.ok(skillScript.includes('/.well-known/skills/zamapay'))
})

test('AI-readable docs use forwarded host when generating absolute URLs', () => {
  const request = new Request('http://localhost:3000/llms.txt', {
    headers: {
      host: '127.0.0.1:3011',
      'x-forwarded-proto': 'https',
    },
  })

  assert.equal(requestOrigin(request), 'https://127.0.0.1:3011')
})

type RenderableNode = {
  attributes?: Record<string, unknown>
  children?: RenderableNode[]
  name?: string
}

function collectTagNames(node: unknown): Array<{ content: unknown; language: unknown; name: string | undefined }> {
  const current = node as RenderableNode
  const results: Array<{ content: unknown; language: unknown; name: string | undefined }> = [
    {
      content: current.attributes?.content ?? current.children?.[0],
      language: current.attributes?.['data-language'],
      name: current.name,
    },
  ]

  for (const child of current.children ?? []) {
    results.push(...collectTagNames(child))
  }

  return results
}
