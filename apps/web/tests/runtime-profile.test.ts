import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contractEnvironmentFromRuntimeProfile,
  normalizeRuntimeProfile,
  runtimeApiBaseUrl,
  runtimeFinalityConfig,
  runtimeOptionalUrl,
  runtimeProfile,
  runtimeProfileForContractEnvironment,
} from '../lib/runtime-profile.ts'

const trackedEnv = [
  'CONFIRMATIONS',
  'FINALITY_THRESHOLD',
  'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_RUNTIME_PROFILE',
  'NEXT_PUBLIC_SEPOLIA_RPC_URL',
  'SEPOLIA_RPC_URL',
  'ZAMAPAY_API_BASE_URL',
  'ZAMAPAY_RUNTIME_PROFILE',
] as const

function withEnv(patch: Partial<Record<(typeof trackedEnv)[number], string | undefined>>, run: () => void) {
  const previous = Object.fromEntries(trackedEnv.map((name) => [name, process.env[name]]))

  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  try {
    run()
  } finally {
    for (const name of trackedEnv) {
      const value = previous[name]
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
}

test('runtime profile keys normalize into explicit profiles', () => {
  assert.equal(normalizeRuntimeProfile(undefined), 'local-dev')
  assert.equal(normalizeRuntimeProfile('local-dev'), 'local-dev')
  assert.equal(normalizeRuntimeProfile('sepolia-local-ui'), 'sepolia-local-ui')
  assert.equal(normalizeRuntimeProfile('sepolia-preview'), 'sepolia-preview')
  assert.equal(contractEnvironmentFromRuntimeProfile('sepolia-preview'), 'sepolia')
  assert.throws(() => normalizeRuntimeProfile('local_dev'), /Unsupported runtime profile/)
  assert.throws(() => normalizeRuntimeProfile('testnet'), /Unsupported runtime profile/)
  assert.throws(() => normalizeRuntimeProfile('mainnet'), /Unsupported runtime profile/)
})

test('runtime URLs come from profile defaults unless env overrides them', () => {
  withEnv(
    {
      NEXT_PUBLIC_API_BASE_URL: undefined,
      NEXT_PUBLIC_RUNTIME_PROFILE: undefined,
      ZAMAPAY_API_BASE_URL: undefined,
      ZAMAPAY_RUNTIME_PROFILE: undefined,
    },
    () => assert.equal(runtimeApiBaseUrl(), 'http://127.0.0.1:8080'),
  )

  withEnv({ ZAMAPAY_API_BASE_URL: 'http://127.0.0.1:18080/' }, () => {
    assert.equal(runtimeApiBaseUrl(), 'http://127.0.0.1:18080')
  })
})

test('sepolia profile has no implicit public RPC fallback', () => {
  withEnv({ NEXT_PUBLIC_SEPOLIA_RPC_URL: undefined, SEPOLIA_RPC_URL: undefined }, () => {
    const profile = runtimeProfileForContractEnvironment('sepolia')
    assert.equal(runtimeOptionalUrl(profile, 'rpcEnv', 'defaultRpcUrl', 'Sepolia RPC URL'), null)
  })

  withEnv({ SEPOLIA_RPC_URL: 'https://rpc.example.test/' }, () => {
    const profile = runtimeProfile('sepolia-local-ui')
    assert.equal(runtimeOptionalUrl(profile, 'rpcEnv', 'defaultRpcUrl', 'Sepolia RPC URL'), 'https://rpc.example.test')
  })
})

test('finality config is profile-backed and rejects unsafe thresholds', () => {
  withEnv({ CONFIRMATIONS: undefined, FINALITY_THRESHOLD: undefined }, () => {
    assert.deepEqual(runtimeFinalityConfig(), { confirmations: 2, finalityThreshold: 2 })
  })

  withEnv({ CONFIRMATIONS: '1', FINALITY_THRESHOLD: '2' }, () => {
    assert.throws(() => runtimeFinalityConfig(), /must be >= FINALITY_THRESHOLD/)
  })
})
