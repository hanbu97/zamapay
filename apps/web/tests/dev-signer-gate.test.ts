import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseDevSigner, isLocalRequestUrl } from '../lib/dev-signer-gate.ts'

test('dev signer allows only explicit local non-production use', () => {
  assert.equal(
    canUseDevSigner({
      contractEnv: 'local-dev',
      enableDevSigner: '1',
      nodeEnv: 'development',
      requestUrl: 'http://127.0.0.1:3001/api/dev/sign-message',
    }),
    true,
  )
})

test('dev signer stays off without explicit opt-in', () => {
  assert.equal(
    canUseDevSigner({
      contractEnv: 'local-dev',
      enableDevSigner: '0',
      nodeEnv: 'development',
      requestUrl: 'http://127.0.0.1:3001/api/dev/sign-message',
    }),
    false,
  )
})

test('dev signer stays off in production and unsupported environments', () => {
  assert.equal(
    canUseDevSigner({
      contractEnv: 'local-dev',
      enableDevSigner: '1',
      nodeEnv: 'production',
      requestUrl: 'http://127.0.0.1:3001/api/dev/sign-message',
    }),
    false,
  )
  assert.equal(
    canUseDevSigner({
      contractEnv: 'testnet',
      enableDevSigner: '1',
      nodeEnv: 'development',
      requestUrl: 'http://127.0.0.1:3001/api/dev/sign-message',
    }),
    false,
  )
})

test('dev signer rejects non-local request hosts', () => {
  assert.equal(isLocalRequestUrl('http://127.0.0.1:3001/api/dev/sign-message'), true)
  assert.equal(isLocalRequestUrl('http://localhost:3001/api/dev/sign-message'), true)
  assert.equal(isLocalRequestUrl('https://mermer.example/api/dev/sign-message'), false)
})
