import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const docsRoot = path.join(repoRoot, "docs", "content", "public")
const skillPath = path.join(repoRoot, "skills", "zamapay", "SKILL.md")
const deprecatedCredentialExports = [
  "ZAMAPAY_PROJECT_ID",
  "ZAMAPAY_API_KEY",
  "ZAMAPAY_CREDENTIALS",
  "ZAMAPAY_WEBHOOK_ENDPOINT_ID",
]

const docs = await import("../apps/web/app/docs/docs-content.ts")

const markdownFiles = fs
  .readdirSync(docsRoot)
  .filter((file) => file.endsWith(".md"))
  .sort()
const pageSlugs = docs.docsPages.map((page) => page.slug)
const fileSlugs = markdownFiles.map((file) => file.replace(/\.md$/, ""))

assert.deepEqual(pageSlugs, [...pageSlugs].sort((left, right) => {
  const leftPage = docs.docsBySlug.get(left)
  const rightPage = docs.docsBySlug.get(right)
  return leftPage.order - rightPage.order || left.localeCompare(right)
}))
assert.deepEqual(new Set(pageSlugs).size, pageSlugs.length, "docs slugs must be unique")
assert.deepEqual(new Set(docs.docsPages.map((page) => page.order)).size, docs.docsPages.length, "docs order must be unique")
assert.deepEqual([...fileSlugs].sort(), [...pageSlugs].sort(), "every public markdown file must load as a docs page")
assert.ok(docs.featuredDocs.length >= 4, "docs home needs at least four featured guides")
assert.ok(docs.docsGroups.length >= 3, "docs home should keep grouped navigation")

for (const page of docs.docsPages) {
  assert.ok(page.title.trim(), `${page.slug} title is required`)
  assert.ok(page.description.trim(), `${page.slug} description is required`)
  assert.ok(page.sections.length > 0, `${page.slug} needs at least one h2 section`)
  assert.deepEqual(
    new Set(page.sections.map((section) => section.id)).size,
    page.sections.length,
    `${page.slug} section ids must be unique`,
  )
}

for (const file of markdownFiles) {
  const content = fs.readFileSync(path.join(docsRoot, file), "utf8")
  for (const name of deprecatedCredentialExports) {
    assert.equal(content.includes(name), false, `${file} must not document deprecated export ${name}`)
  }
}

const baseUrl = "https://docs.example.test"
const llms = docs.buildLlmsTxt(baseUrl)
const full = docs.buildLlmsFullTxt(baseUrl)
const manifest = docs.buildDocsManifest(baseUrl)
assert.ok(llms.includes("/llms-full.txt"), "llms.txt must link the full docs corpus")
assert.ok(llms.includes("/docs/quickstart.md"), "llms.txt must link per-page markdown")
assert.ok(full.includes("# Quickstart"), "llms-full.txt must include public docs content")
assert.equal(manifest.pages.length, docs.docsPages.length, "docs manifest must cover every docs page")
assert.deepEqual(manifest.rules, docs.aiIntegrationRules, "docs manifest rules must match the AI guardrails")

const skill = fs.readFileSync(skillPath, "utf8")
for (const required of [
  "ZAMAPAY_SECRET_KEY",
  "paymentRail",
  "raw request body",
  "evm_erc20",
  "zama_private",
  "Withdrawals, delivery resend, project secret revoke, and webhook secret rotation require explicit human confirmation",
]) {
  assert.ok(skill.includes(required), `ZamaPay skill must include guardrail: ${required}`)
}

console.log(
  `public docs ok: ${docs.docsPages.length} pages, ${docs.docsGroups.length} groups, AI outputs covered`,
)
