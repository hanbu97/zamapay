#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const envPath = path.join(projectRoot, 'env', 'local-dev.cardforge-backend.env')
const fallbackPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

async function main() {
  const localEnv = readEnv(envPath)
  const apiBaseUrl = stripTrailingSlash(
    process.env.ZAMAPAY_API_BASE_URL || process.env.ZAMAPAY_API_URL || localEnv.ZAMAPAY_API_URL || 'http://127.0.0.1:8080',
  )
  const account = await localAccount()
  const sessionCookie = await walletSessionCookie(apiBaseUrl, account)
  const merchantLabel = localEnv.CARDFORGE_MERCHANT_LABEL || 'CardForge Demo Store'
  const webhookUrl = localEnv.CARDFORGE_WEBHOOK_ENDPOINT || 'http://127.0.0.1:8092/api/zamapay/webhook'

  const createdProject = await apiJson(`${apiBaseUrl}/api/projects`, {
    method: 'POST',
    headers: jsonHeaders(sessionCookie),
    body: JSON.stringify({
      environment: 'local_dev',
      name: merchantLabel,
      webhookUrl,
    }),
  })
  const projectId = createdProject.project?.projectId

  if (!projectId) {
    throw new Error('ZamaPay project creation did not return project.projectId.')
  }

  const createdKey = await apiJson(`${apiBaseUrl}/api/projects/${encodeURIComponent(projectId)}/api-keys`, {
    method: 'POST',
    headers: jsonHeaders(sessionCookie),
    body: JSON.stringify({
      environment: 'local_dev',
      label: 'CardForge local dev',
    }),
  })
  const apiKey = createdKey.apiKey

  if (!apiKey) {
    throw new Error('ZamaPay API key creation did not return apiKey.')
  }

  writeEnv(envPath, {
    ZAMAPAY_API_URL: apiBaseUrl,
    ZAMAPAY_API_KEY: apiKey,
    ZAMAPAY_PROJECT_ID: projectId,
    ...(createdProject.webhookSecret ? { ZAMAPAY_WEBHOOK_SECRET: createdProject.webhookSecret } : {}),
  })

  console.log(`seeded CardForge local project: ${projectId}`)
  console.log(`updated ${path.relative(projectRoot, envPath)}`)
}

async function localAccount() {
  const { privateKeyToAccount } = await import('viem/accounts')
  return privateKeyToAccount(process.env.ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY || fallbackPrivateKey)
}

async function walletSessionCookie(apiBaseUrl, account) {
  const challenge = await apiJson(`${apiBaseUrl}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: account.address }),
  })
  const signature = await account.signMessage({ message: challenge.message })
  const response = await fetch(`${apiBaseUrl}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: account.address,
      message: challenge.message,
      nonce: challenge.nonce,
      signature,
    }),
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`Wallet login failed with ${response.status}: ${body}`)
  }

  const setCookie = firstSetCookie(response.headers)
  if (!setCookie?.startsWith('zamapay_session=')) {
    throw new Error('Wallet login did not return a zamapay_session cookie.')
  }

  return setCookie.split(';')[0]
}

async function apiJson(url, options) {
  const response = await fetch(url, options)
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${body}`)
  }

  return JSON.parse(body)
}

function jsonHeaders(sessionCookie) {
  return {
    'content-type': 'application/json',
    cookie: sessionCookie,
  }
}

function firstSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()[0]
  }

  return headers.get('set-cookie')
}

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], unquoteEnv(match[2])]),
  )
}

function writeEnv(filePath, updates) {
  const seen = new Set()
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/) : []
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (!match || !Object.hasOwn(updates, match[1])) {
      return line
    }

    seen.add(match[1])
    return `${match[1]}=${quoteEnv(updates[match[1]])}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${quoteEnv(value)}`)
    }
  }

  fs.writeFileSync(filePath, `${nextLines.filter((line, index) => line !== '' || index < nextLines.length - 1).join('\n')}\n`)
}

function unquoteEnv(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function quoteEnv(value) {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value)
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
