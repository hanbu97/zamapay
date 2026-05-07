import assert from 'node:assert/strict'
import test from 'node:test'
import { loginCookie } from './support/auth.ts'
import { API_BASE_URL, readJson, readText, WEB_BASE_URL } from './support/http.ts'

test('auth-login e2e mints a Rust session and guards dashboard access', async () => {
  const anonymous = await fetch(`${WEB_BASE_URL}/dashboard`, { redirect: 'manual' })
  assert.match(anonymous.headers.get('location') ?? '', /\/login/)

  const login = await loginCookie()
  const session = await readJson<{ authenticated: boolean; user?: { address?: string } }>(`${API_BASE_URL}/api/session`, {
    headers: { cookie: login.cookie },
  })
  assert.equal(session.authenticated, true)
  assert.equal(session.user?.address?.toLowerCase(), login.address.toLowerCase())

  const dashboard = await readText(`${WEB_BASE_URL}/dashboard`, {
    headers: { cookie: login.cookie },
  })
  assert.match(dashboard, /Payments/)
  assert.match(dashboard, /No payment project|Checkout sessions/)
})
