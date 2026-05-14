import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canUseDevSigner,
  canUseLocalDevServerBridge,
  canUseSepoliaServerBridge,
  isLocalRequestUrl,
} from '../lib/dev-signer-gate.ts'

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
  assert.equal(isLocalRequestUrl('https://zamapay.example/api/dev/sign-message'), false)
})

test('local chain invoice bridge allows local non-production server calls without browser signer opt-in', () => {
  assert.equal(
    canUseLocalDevServerBridge({
      contractEnv: 'local-dev',
      nodeEnv: 'development',
      requestUrl: 'http://127.0.0.1:3001/api/dev/local-chain-invoice',
    }),
    true,
  )
})

test('local chain invoice bridge rejects production or remote hosts', () => {
  assert.equal(
    canUseLocalDevServerBridge({
      contractEnv: 'local-dev',
      nodeEnv: 'production',
      requestUrl: 'http://127.0.0.1:3001/api/dev/local-chain-invoice',
    }),
    false,
  )
  assert.equal(
    canUseLocalDevServerBridge({
      contractEnv: 'local-dev',
      nodeEnv: 'development',
      requestUrl: 'https://zamapay.example/api/dev/local-chain-invoice',
    }),
    false,
  )
})

test('sepolia server bridge lets production project secret calls reach validation', () => {
  assert.equal(
    canUseSepoliaServerBridge({
      authorizationHeader: 'Bearer zms_test_project_key',
      nodeEnv: 'production',
      requestUrl: 'https://zamapay.org/api/dev/local-chain-invoice',
    }),
    true,
  )
  assert.equal(
    canUseSepoliaServerBridge({
      nodeEnv: 'production',
      requestUrl: 'https://zamapay.org/api/dev/local-chain-invoice',
    }),
    false,
  )
  assert.equal(
    canUseSepoliaServerBridge({
      nodeEnv: 'development',
      requestUrl: 'http://127.0.0.1:3001/api/dev/local-chain-invoice',
    }),
    true,
  )
})
