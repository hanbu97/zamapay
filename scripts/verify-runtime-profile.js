const {
  assert,
  assertConsistentEnvironment,
  envValue,
  manifestPath,
  profileNumber,
  profileOptionalUrl,
  profileUrl,
  readManifest,
  runtimeProfile,
} = require('./runtime-profile')

function check(name, run) {
  const detail = run()
  return { name, ok: true, detail }
}

function main() {
  const profile = runtimeProfile(process.argv[2])
  const checks = []

  checks.push(check('runtime profile contract', () => {
    assert(profile.contractEnvironment, `${profile.key} missing contractEnvironment`)
    assert(profile.projectEnvironment, `${profile.key} missing projectEnvironment`)
    assert(Number.isSafeInteger(profile.chainId), `${profile.key} missing chainId`)
    assert(profile.nativeCurrency?.symbol, `${profile.key} missing nativeCurrency`)
    return `${profile.label} -> ${profile.contractEnvironment}`
  }))

  checks.push(check('environment consistency', () => {
    assertConsistentEnvironment(profile)
    return 'consistent'
  }))

  const manifest = readManifest(profile)
  checks.push(check('contract manifest', () => ({
    file: manifestPath(profile),
    chainId: manifest.chainId,
    settlement: manifest.contracts.PrivateCheckoutSettlement,
  })))

  checks.push(check('runtime URLs', () => {
    const apiBaseUrl = profileUrl(profile, 'apiBaseEnv', 'defaultApiBaseUrl', 'API base URL')
    const webBaseUrl = profileUrl(profile, 'webBaseEnv', 'defaultWebBaseUrl', 'web base URL')
    const checkoutBaseUrl = profileUrl(profile, 'checkoutBaseEnv', 'defaultCheckoutBaseUrl', 'checkout base URL')
    const rpcUrl = profile.requiresExplicitRpc
      ? profileUrl(profile, 'rpcEnv', 'defaultRpcUrl', 'RPC URL')
      : profileOptionalUrl(profile, 'rpcEnv', 'defaultRpcUrl', 'RPC URL')
    const explorerUrl = profileOptionalUrl(profile, 'explorerEnv', 'defaultExplorerUrl', 'block explorer URL')

    return {
      apiBaseUrl,
      checkoutBaseUrl,
      explorerUrl,
      rpcUrl,
      webBaseUrl,
    }
  }))

  checks.push(check('finality settings', () => {
    const confirmations = profileNumber('CONFIRMATIONS', profile.confirmations)
    const finalityThreshold = profileNumber('FINALITY_THRESHOLD', profile.finalityThreshold)
    assert(confirmations >= finalityThreshold, `CONFIRMATIONS (${confirmations}) must be >= FINALITY_THRESHOLD (${finalityThreshold})`)
    return { confirmations, finalityThreshold }
  }))

  checks.push(check('bridge policy', () => ({
    allowsDevSigner: profile.allowsDevSigner,
    allowsServerInvoiceBridge: profile.allowsServerInvoiceBridge,
    chainInvoiceSignerConfigured: Boolean(envValue(['ZAMAPAY_CHAIN_INVOICE_PRIVATE_KEY'])),
  })))

  console.log(
    JSON.stringify(
      {
        ok: true,
        profile: profile.key,
        contractEnvironment: profile.contractEnvironment,
        checks,
      },
      null,
      2,
    ),
  )
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
