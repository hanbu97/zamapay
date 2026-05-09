const fs = require('fs')
const net = require('net')
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
  if (!process.env.MERMER_API_BASE_URL) {
    return spawnIsolatedApi()
  }

  try {
    const response = await fetch(`${apiBaseUrl}/health`)
    const projects = response.ok ? await fetch(`${apiBaseUrl}/api/projects`) : null
    if (response.ok && projects?.status !== 404) {
      return { spawned: false }
    }
  } catch {}

  return spawnIsolatedApi()
}

async function spawnIsolatedApi() {
  const port = await getFreePort()
  apiBaseUrl = `http://127.0.0.1:${port}`
  const stateKey = `merchant-project-loop-${Date.now()}`
  spawnService('mermer-api', 'cargo', ['run', '-p', 'api'], {
    cwd: ROOT,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://mermer:mermer@127.0.0.1:5432/mermer',
      MERMER_API_BIND: `127.0.0.1:${port}`,
      MERMER_PORTAL_STATE_KEY: stateKey,
      MERMER_WEBHOOK_SECRET: `loop-root-secret-${Date.now()}`,
    },
  })
  await text(`${apiBaseUrl}/health`)
  return { spawned: true, stateKey }
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
  return {
    address: account.address,
    cookie: setCookie.split(';')[0],
  }
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

async function createCardForgeCheckout(cardForgeUrl, expectedBilling) {
  const checkout = await json(`${cardForgeUrl}/api/orders/checkout`, {
    method: 'POST',
    headers: {
      cookie: 'mermer_session=must-not-matter',
    },
  })
  assert(checkout.checkoutUrl?.includes('/checkout/'), 'CardForge checkout did not return hosted checkout URL')
  assert(checkout.chainInvoiceId > 0, 'CardForge checkout did not return chain invoice id')
  assert(checkout.billing?.plan === expectedBilling.plan, `${expectedBilling.plan} checkout did not use expected billing plan`)
  assert(checkout.billing?.feeBps === expectedBilling.feeBps, `${expectedBilling.plan} checkout fee bps is wrong`)
  assert(
    checkout.billing?.platformFeeMinorUnits === expectedBilling.platformFeeMinorUnits,
    `${expectedBilling.plan} checkout fee quote is wrong`,
  )
  assert(
    checkout.billing?.merchantNetMinorUnits === expectedBilling.merchantNetMinorUnits,
    `${expectedBilling.plan} checkout net quote is wrong`,
  )
  return checkout
}

async function projectGrowthEntitlement(ownerWallet) {
  const entropy = BigInt(Date.now())
  const projected = await json(`${apiBaseUrl}/api/operator/subscription-entitlements/${ownerWallet}/projection`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
    },
    body: JSON.stringify({
      plan: 'growth',
      billingCycle: 'monthly',
      passId: `pass_growth_${entropy.toString(16)}`,
      entitlementVersion: Number(entropy % 1_000_000n) + 1,
      entitlementTxHash: `0x${(entropy + 1n).toString(16).padStart(64, '0')}`,
      subscriptionCheckHandle: `0x${(entropy + 2n).toString(16).padStart(64, '0')}`,
    }),
  })

  assert(projected.subscription?.plan === 'growth', 'subscription projection did not anchor Growth')
  assert(projected.subscription?.entitlementStatus === 'anchored', 'subscription projection is not anchored')
  assert(projected.payments?.[0]?.amountMinorUnits === 99000000, 'Growth subscription payment amount is wrong')
  return projected
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
  const loginSession = await login()
  const cardForgePort = await getFreePort()
  const webhookUrl = `http://127.0.0.1:${cardForgePort}/api/mermer-pay/webhook`
  const project = await createProject(loginSession.cookie, webhookUrl)
  const apiKey = await createApiKey(loginSession.cookie, project.project.projectId)
  const cardForgeUrl = await startCardForge({
    apiKey,
    projectId: project.project.projectId,
    webhookSecret: project.webhookSecret,
    port: cardForgePort,
  })

  const freeCheckout = await createCardForgeCheckout(cardForgeUrl, {
    feeBps: 50,
    merchantNetMinorUnits: 119400000,
    plan: 'free',
    platformFeeMinorUnits: 600000,
  })
  await projectPayment(freeCheckout.chainInvoiceId)

  await projectGrowthEntitlement(loginSession.address)

  const growthCheckout = await createCardForgeCheckout(cardForgeUrl, {
    feeBps: 25,
    merchantNetMinorUnits: 119700000,
    plan: 'growth',
    platformFeeMinorUnits: 300000,
  })
  await projectPayment(growthCheckout.chainInvoiceId)

  const webhooks = await json(`${cardForgeUrl}/api/mermer-pay/webhooks`)
  assert(webhooks.receivedEventCount === 2, `CardForge expected two webhooks, got ${webhooks.receivedEventCount}`)

  const overview = await json(`${apiBaseUrl}/api/projects/${project.project.projectId}`, {
    headers: { cookie: loginSession.cookie },
  })
  assert(overview.summary.totalCheckouts === 2, 'dashboard total checkout count is wrong')
  assert(overview.summary.paidCheckouts === 2, 'dashboard paid checkout count is wrong')
  assert(overview.summary.grossVolumeMinorUnits === 240000000, 'dashboard gross volume is wrong')
  assert(overview.summary.platformFeeMinorUnits === 900000, 'dashboard fee total is wrong')
  assert(overview.summary.merchantNetMinorUnits === 239100000, 'dashboard net total is wrong')
  assert(overview.summary.deliveredWebhooks === 2, 'dashboard delivered webhook count is wrong')

  console.log(JSON.stringify({
    ok: true,
    apiSpawned: api.spawned,
    cardForgeUrl,
    freeCheckoutSessionId: freeCheckout.checkoutSessionId,
    growthCheckoutSessionId: growthCheckout.checkoutSessionId,
    freeChainInvoiceId: freeCheckout.chainInvoiceId,
    growthChainInvoiceId: growthCheckout.chainInvoiceId,
    grossVolumeMinorUnits: overview.summary.grossVolumeMinorUnits,
    merchantNetMinorUnits: overview.summary.merchantNetMinorUnits,
    platformFeeMinorUnits: overview.summary.platformFeeMinorUnits,
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
