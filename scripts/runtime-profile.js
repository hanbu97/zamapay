const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PROFILE_PATH = path.join(ROOT, 'env', 'runtime-profiles.json')
const profileContract = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'))

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function cleanKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function normalizeRuntimeProfile(value) {
  const raw = cleanKey(value || process.env.ZAMAPAY_RUNTIME_PROFILE || process.env.NEXT_PUBLIC_RUNTIME_PROFILE)
  const key = raw || profileContract.defaultProfile

  if (!profileContract.profiles[key]) {
    throw new Error(`Unsupported runtime profile "${value}".`)
  }

  return key
}

function runtimeProfile(value) {
  const key = normalizeRuntimeProfile(value)
  return {
    key,
    ...profileContract.profiles[key],
  }
}

function envValue(names) {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function profileValue(profile, field, fallbackField) {
  return envValue(profile[field] || []) ?? profile[fallbackField] ?? null
}

function profileUrl(profile, field, fallbackField, label) {
  const value = profileValue(profile, field, fallbackField)
  assert(value, `${label} is not configured for ${profile.key}`)

  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`)
  }
}

function profileOptionalUrl(profile, field, fallbackField, label) {
  const value = profileValue(profile, field, fallbackField)
  if (!value) {
    return null
  }

  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`)
  }
}

function profileNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }

  const value = Number(raw)
  assert(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`)
  return value
}

function manifestPath(profile) {
  return path.join(ROOT, 'generated', 'contracts', 'addresses', `${profile.contractEnvironment}.json`)
}

function readManifest(profile) {
  const filePath = manifestPath(profile)
  assert(fs.existsSync(filePath), `${profile.contractEnvironment} manifest is missing: ${filePath}`)

  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  assert(
    manifest.chainId === profile.chainId,
    `${profile.contractEnvironment} manifest chainId must be ${profile.chainId}, got ${manifest.chainId}`,
  )
  for (const name of ['MerchantRegistry', 'ConfidentialUSDMock', 'PrivateCheckoutSettlement']) {
    assert(manifest.contracts?.[name]?.startsWith('0x'), `${name} is missing from ${profile.contractEnvironment} manifest`)
  }

  return manifest
}

function placeholderValue(value) {
  return /replace-with|example|your-/iu.test(value)
}

function assertConsistentEnvironment(profile) {
  for (const [name, value] of [
    ['ZAMAPAY_RUNTIME_PROFILE', process.env.ZAMAPAY_RUNTIME_PROFILE],
    ['NEXT_PUBLIC_RUNTIME_PROFILE', process.env.NEXT_PUBLIC_RUNTIME_PROFILE],
  ]) {
    if (!value?.trim()) {
      continue
    }

    assert(
      normalizeRuntimeProfile(value) === profile.key,
      `${name}=${value} does not match selected profile ${profile.key}`,
    )
  }

  if (profile.requiresExplicitRpc) {
    const rpcUrl = envValue(profile.rpcEnv || [])
    assert(rpcUrl, `${profile.key} requires one of: ${(profile.rpcEnv || []).join(', ')}`)
    assert(!placeholderValue(rpcUrl), `${profile.key} RPC URL is still a placeholder`)
  }

  if (!profile.allowsDevSigner) {
    assert(process.env.ZAMAPAY_ENABLE_DEV_SIGNER !== '1', `${profile.key} must not enable ZAMAPAY_ENABLE_DEV_SIGNER`)
  }

  if (!profile.allowsServerInvoiceBridge) {
    assert(
      !envValue(['ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY']),
      `${profile.key} must not configure ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY`,
    )
  }

  if (profile.requiresHttpsPublicUrls) {
    for (const [field, fallback, label] of [
      ['apiBaseEnv', 'defaultApiBaseUrl', 'API base URL'],
      ['webBaseEnv', 'defaultWebBaseUrl', 'web base URL'],
      ['checkoutBaseEnv', 'defaultCheckoutBaseUrl', 'checkout base URL'],
    ]) {
      const url = profileUrl(profile, field, fallback, label)
      assert(url.startsWith('https://'), `${profile.key} ${label} must be https: ${url}`)
    }
  }
}

module.exports = {
  ROOT,
  assert,
  assertConsistentEnvironment,
  envValue,
  manifestPath,
  normalizeRuntimeProfile,
  profileContract,
  profileNumber,
  profileOptionalUrl,
  profileUrl,
  profileValue,
  readManifest,
  runtimeProfile,
}
