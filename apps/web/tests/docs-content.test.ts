import assert from 'node:assert/strict'
import test from 'node:test'

import { highlightCode } from '../app/docs/code-highlighting.ts'
import {
  docsBrowseSections,
  docsBySlug,
  docsEntryPoints,
  docsGroups,
  docsPages,
  docsTopCategories,
  featuredDocs,
} from '../app/docs/docs-content.ts'
import { resolveDocsTagName } from '../app/docs/markdoc-rendering.ts'

test('public docs load from Markdoc files with stable route metadata', () => {
  assert.ok(docsPages.length >= 10)
  assert.equal(docsPages[0].slug, 'quickstart')
  assert.ok(docsBySlug.has('development'))
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
