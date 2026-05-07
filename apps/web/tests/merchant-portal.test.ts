import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiRequestError, getPaymentProjects } from '../lib/api.ts'
import { loadMerchantProjects } from '../lib/merchant-portal.ts'

test('project list exposes backend status instead of throwing opaque errors', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async () => new Response('missing session', { status: 401 })) as typeof fetch

  await assert.rejects(
    () => getPaymentProjects('mermer_session=test'),
    (error) => error instanceof ApiRequestError && error.status === 401 && error.message === 'missing session',
  )
})

test('merchant project loader separates unauthorized from unavailable', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async () => new Response('missing session', { status: 401 })) as typeof fetch
  assert.deepEqual(await loadMerchantProjects('mermer_session=test'), {
    reason: 'missing session',
    status: 'unauthorized',
  })

  globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch
  assert.deepEqual(await loadMerchantProjects('mermer_session=test'), {
    reason: 'Payment project list failed with 404: Project list failed with 404.',
    status: 'unavailable',
  })
})
