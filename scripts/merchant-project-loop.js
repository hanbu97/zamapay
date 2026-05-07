const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const OPERATOR_KEY = process.env.MERMER_OPERATOR_KEY ?? 'local-operator-dev-key'
const LOGIN_PRIVATE_KEY =
  process.env.MERMER_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

const services = []
let apiBaseUrl = process.env.MERMER_API_BASE_URL ?? 'http://127.0.0.1:8080'

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}) {
  let lastError

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (response.ok || response.status < 500) {
        return response
      }
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await delay(250)
  }

  throw lastError
}

async function text(url, options = {}) {
  const response = await fetchWithRetry(url, options)
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${body}`)
  }

  return body
}

async function json(url, options = {}) {
  return JSON.parse(await text(url, options))
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function spawnService(name, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []

  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      logs.push(`${name} exited with ${code}\n`)
    }
  })

  const service = { child, logs, name }
  services.push(service)
  return service
}

async function ensureApi() {
  try {
    const response = await fetch(`${apiBaseUrl}/health`)
    const projects = response.ok ? await fetch(`${apiBaseUrl}/api/projects`) : null
    if (response.ok && projects?.status !== 404) {
      return { spawned: false }
    }
  } catch {}

  const port = await getFreePort()
  apiBaseUrl = `http://127.0.0.1:${port}`
  const storePath = path.join(os.tmpdir(), `mermer-project-loop-${Date.now()}.json`)
  spawnService('mermer-api', 'cargo', ['run', '-p', 'api'], {
    cwd: ROOT,
    env: {
      MERMER_API_BIND: `127.0.0.1:${port}`,
      MERMER_PORTAL_STORE_PATH: storePath,
      MERMER_WEBHOOK_SECRET: `loop-root-secret-${Date.now()}`,
    },
  })
  await text(`${apiBaseUrl}/health`)
  return { spawned: true, storePath }
}

async function startCardForge(config) {
  const port = config.port ?? await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  spawnService('cardforge-backend', 'cargo', ['run'], {
    cwd: path.join(ROOT, 'demo', 'cardforge', 'backend'),
    env: {
      CARDFORGE_BACKEND_BIND: `127.0.0.1:${port}`,
      CARDFORGE_WEBHOOK_ENDPOINT: `${baseUrl}/api/mermer-pay/webhook`,
      MERMER_PAY_API_KEY: config.apiKey,
      MERMER_PAY_API_URL: apiBaseUrl,
      MERMER_PAY_CONSOLE_URL: 'http://127.0.0.1:3001/merchant',
      MERMER_PAY_PROJECT_ID: config.projectId,
      MERMER_PAY_WEBHOOK_SECRET: config.webhookSecret,
    },
  })
  await text(`${baseUrl}/health`)
  return baseUrl
}

async function login() {
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(LOGIN_PRIVATE_KEY)
  const challenge = await json(`${apiBaseUrl}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: account.address }),
  })
  const signature = await account.signMessage({ message: challenge.message })
  const response = await fetchWithRetry(`${apiBaseUrl}/api/auth/verify`, {
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
    throw new Error(`login failed with ${response.status}: ${body}`)
  }

  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()[0]
    : response.headers.get('set-cookie')
  assert(setCookie?.startsWith('mermer_session='), 'login did not return mermer_session')
  return setCookie.split(';')[0]
}

async function createProject(cookie, webhookUrl) {
  const created = await json(`${apiBaseUrl}/api/projects`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      environment: 'local_dev',
      name: `CardForge loop ${Date.now()}`,
      webhookUrl,
    }),
  })
  assert(created.project?.projectId, 'project creation did not return project id')
  assert(created.webhookSecret?.startsWith('whsec_'), 'project creation did not return webhook secret')
  return created
}

async function createApiKey(cookie, projectId) {
  const created = await json(`${apiBaseUrl}/api/projects/${projectId}/api-keys`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ environment: 'local_dev', label: 'CardForge loop backend' }),
  })
  assert(created.apiKey?.startsWith('mmp_test_'), 'API key creation did not return secret')
  return created.apiKey
}

async function createCardForgeCheckout(cardForgeUrl) {
  const checkout = await json(`${cardForgeUrl}/api/orders/checkout`, {
    method: 'POST',
    headers: {
      cookie: 'mermer_session=must-not-matter',
    },
  })
  assert(checkout.checkoutUrl?.includes('/checkout/'), 'CardForge checkout did not return hosted checkout URL')
  assert(checkout.chainInvoiceId > 0, 'CardForge checkout did not return chain invoice id')
  return checkout
}

async function projectPayment(chainInvoiceId) {
  await json(`${apiBaseUrl}/api/operator/chain-invoices/${chainInvoiceId}/payment-projection`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
    },
    body: JSON.stringify({
      payerAddress: '0x0000000000000000000000000000000000000002',
      paymentTxHash: `0x${chainInvoiceId.toString(16).padStart(64, '0')}`,
    }),
  })
  await json(`${apiBaseUrl}/api/operator/chain-invoices/${chainInvoiceId}/confirmations`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
    },
    body: JSON.stringify({
      confirmations: 2,
      finalityThreshold: 2,
    }),
  })
}

function stopServices() {
  for (const service of services.reverse()) {
    if (!service.child.killed) {
      service.child.kill('SIGTERM')
    }
  }
}

async function main() {
  const api = await ensureApi()
  const cookie = await login()
  const cardForgePort = await getFreePort()
  const webhookUrl = `http://127.0.0.1:${cardForgePort}/api/mermer-pay/webhook`
  const project = await createProject(cookie, webhookUrl)
  const apiKey = await createApiKey(cookie, project.project.projectId)
  const cardForgeUrl = await startCardForge({
    apiKey,
    projectId: project.project.projectId,
    webhookSecret: project.webhookSecret,
    port: cardForgePort,
  })

  const checkout = await createCardForgeCheckout(cardForgeUrl)
  await projectPayment(checkout.chainInvoiceId)

  const webhooks = await json(`${cardForgeUrl}/api/mermer-pay/webhooks`)
  assert(webhooks.receivedEventCount === 1, `CardForge expected one webhook, got ${webhooks.receivedEventCount}`)

  const overview = await json(`${apiBaseUrl}/api/projects/${project.project.projectId}`, {
    headers: { cookie },
  })
  assert(overview.summary.totalCheckouts === 1, 'dashboard total checkout count is wrong')
  assert(overview.summary.paidCheckouts === 1, 'dashboard paid checkout count is wrong')
  assert(overview.summary.deliveredWebhooks === 1, 'dashboard delivered webhook count is wrong')

  console.log(JSON.stringify({
    ok: true,
    apiSpawned: api.spawned,
    cardForgeUrl,
    checkoutSessionId: checkout.checkoutSessionId,
    chainInvoiceId: checkout.chainInvoiceId,
    projectId: project.project.projectId,
    webhookDeliveries: overview.webhookDeliveries.map((delivery) => ({
      attemptCount: delivery.attemptCount,
      httpStatus: delivery.httpStatus,
      status: delivery.status,
    })),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    for (const service of services) {
      const tail = service.logs.join('').split('\n').slice(-40).join('\n')
      if (tail.trim()) {
        console.error(`\n--- ${service.name} log tail ---\n${tail}`)
      }
    }
    process.exitCode = 1
  })
  .finally(() => {
    stopServices()
  })
