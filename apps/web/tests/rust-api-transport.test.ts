import assert from 'node:assert/strict'
import test from 'node:test'
import { encodedRustPath, rustApiUrl } from '../lib/rust-api-transport.ts'

test('rust transport encodes forwarded route path segments once', () => {
  assert.equal(encodedRustPath('/api/projects', []), '/api/projects')
  assert.equal(encodedRustPath('/api/projects/', ['proj 1', 'api-keys']), '/api/projects/proj%201/api-keys')
  assert.equal(encodedRustPath('/api/billing', ['subscription']), '/api/billing/subscription')
})

test('rust transport keeps query forwarding separate from path construction', () => {
  const url = rustApiUrl('/api/projects/proj_123', '?tab=payments')

  assert.equal(url.pathname, '/api/projects/proj_123')
  assert.equal(url.search, '?tab=payments')
})
