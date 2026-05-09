const fs = require('fs')
const path = require('path')

const API_BASE_URL = process.env.MERMER_API_BASE_URL ?? 'http://127.0.0.1:8080'
const WEB_BASE_URL = process.env.MERMER_WEB_BASE_URL ?? 'http://127.0.0.1:3001'
const ROOT = path.resolve(__dirname, '..')
const LOCAL_LOGIN_PRIVATE_KEY =
  process.env.MERMER_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

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

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, options)
    } catch (error) {
      lastError = error

      if (attempt === 4) {
        break
      }

      await delay(250 * attempt)
    }
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

async function check(name, run) {
  const detail = await run()
  return { name, ok: true, detail }
}

function readLocalManifest() {
  const manifestPath = path.join(ROOT, 'generated', 'contracts', 'addresses', 'local-dev.json')
  assert(fs.existsSync(manifestPath), `local-dev manifest is missing: ${manifestPath}`)

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert(manifest.chainId === 31337, `local-dev manifest chainId must be 31337, got ${manifest.chainId}`)
  assert(manifest.contracts?.MerchantRegistry?.startsWith('0x'), 'MerchantRegistry is missing from local-dev manifest')
  assert(manifest.contracts?.ConfidentialUSDMock?.startsWith('0x'), 'ConfidentialUSDMock is missing from local-dev manifest')
  assert(
    manifest.contracts?.PrivateCheckoutSettlement?.startsWith('0x'),
    'PrivateCheckoutSettlement is missing from local-dev manifest',
  )

  return manifest
}

function firstSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()[0]
  }

  return headers.get('set-cookie')
}

async function runWalletLoginProof() {
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(LOCAL_LOGIN_PRIVATE_KEY)
  const challenge = await json(`${API_BASE_URL}/api/auth/nonce`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: account.address }),
  })
  const signature = await account.signMessage({ message: challenge.message })

  const verifyResponse = await fetchWithRetry(`${API_BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: account.address,
      nonce: challenge.nonce,
      message: challenge.message,
      signature,
    }),
  })
  const verifyBody = await verifyResponse.text()

  if (!verifyResponse.ok) {
    throw new Error(`wallet login failed with ${verifyResponse.status}: ${verifyBody}`)
  }

  const setCookie = firstSetCookie(verifyResponse.headers)
  assert(setCookie?.startsWith('mermer_session='), 'wallet login did not mint mermer_session cookie')
  const sessionCookie = setCookie.split(';')[0]
  const session = await json(`${API_BASE_URL}/api/session`, {
    headers: { cookie: sessionCookie },
  })

  assert(session.authenticated === true, 'session endpoint did not accept login cookie')
  assert(
    session.user?.address?.toLowerCase() === account.address.toLowerCase(),
    `session address mismatch: expected ${account.address}, got ${session.user?.address}`,
  )

  const dashboardHtml = await text(`${WEB_BASE_URL}/dashboard`, {
    headers: { cookie: sessionCookie },
  })
  assert(dashboardHtml.includes('Overview'), 'dashboard did not render after wallet login')
  assert(
    dashboardHtml.toLowerCase().includes(account.address.toLowerCase()),
    'dashboard did not render the signed-in wallet address',
  )

  return account.address
}

async function runDevSignerBoundaryProof() {
  const response = await fetchWithRetry(`${WEB_BASE_URL}/api/dev/sign-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'dev signer readiness probe' }),
  })
  const body = await response.text()

  if (response.ok) {
    const parsed = JSON.parse(body)
    assert(parsed.signature?.startsWith('0x'), 'enabled dev signer did not return a signature')
    return 'enabled'
  }

  assert(response.status === 404, `dev signer returned an unexpected status ${response.status}: ${body}`)
  return 'disabled'
}

async function main() {
  const checks = []
  const localManifest = readLocalManifest()

  checks.push(await check('local manifest', async () => localManifest.contracts.PrivateCheckoutSettlement))
  checks.push(await check('Rust API health', async () => {
    const health = await text(`${API_BASE_URL}/health`)
    assert(health === 'ok', `unexpected health response: ${health}`)
    return health
  }))
  checks.push(await check('Rust API contract manifest', async () => {
    const manifest = await json(`${API_BASE_URL}/api/contracts/local-dev`)
    assert(manifest.chainId === 31337, `API manifest chainId must be 31337, got ${manifest.chainId}`)
    assert(
      manifest.contracts?.PrivateCheckoutSettlement === localManifest.contracts.PrivateCheckoutSettlement,
      `API PrivateCheckoutSettlement is stale: expected ${localManifest.contracts.PrivateCheckoutSettlement}, got ${manifest.contracts?.PrivateCheckoutSettlement}`,
    )
    assert(
      manifest.contracts?.ConfidentialUSDMock === localManifest.contracts.ConfidentialUSDMock,
      `API ConfidentialUSDMock is stale: expected ${localManifest.contracts.ConfidentialUSDMock}, got ${manifest.contracts?.ConfidentialUSDMock}`,
    )
    assert(
      manifest.contracts?.PrivateCheckoutSettlement?.startsWith('0x'),
      'API manifest is missing PrivateCheckoutSettlement',
    )
    assert(
      manifest.contracts?.ConfidentialUSDMock?.startsWith('0x'),
      'API manifest is missing ConfidentialUSDMock',
    )
    return manifest.contracts.PrivateCheckoutSettlement
  }))
  checks.push(await check('Next homepage', async () => {
    const html = await text(`${WEB_BASE_URL}/`)
    assert(html.includes('Mermer Pay'), 'homepage does not contain Mermer Pay')
    return 'loaded'
  }))
  checks.push(await check('Payment platform boundary', async () => {
    const html = await text(`${WEB_BASE_URL}/`)
    assert(html.includes('Private checkout infrastructure'), 'homepage does not render public payment platform copy')
    for (const forbidden of [
      'CardForge prepaid card bundle',
      'Three CardForge demo codes',
      'Card issuing demo storefront',
    ]) {
      assert(!html.includes(forbidden), `homepage must not expose merchant-template copy: ${forbidden}`)
    }
    return 'loaded'
  }))
  checks.push(await check('wallet login and protected dashboard', async () => runWalletLoginProof()))
  checks.push(await check('dev signer boundary', async () => runDevSignerBoundaryProof()))

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: API_BASE_URL,
        webBaseUrl: WEB_BASE_URL,
        checks,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
