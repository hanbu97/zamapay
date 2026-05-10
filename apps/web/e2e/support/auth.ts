import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'
import { API_BASE_URL, postJson } from './http.ts'

const LOCAL_LOGIN_PRIVATE_KEY =
  process.env.ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function firstSetCookie(headers: Headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()[0]
  }

  return headers.get('set-cookie')
}

export async function loginCookie() {
  const account = privateKeyToAccount(LOCAL_LOGIN_PRIVATE_KEY as `0x${string}`)
  const challenge = await postJson<{ message: string; nonce: string }>(`${API_BASE_URL}/api/auth/nonce`, {
    address: account.address,
  })
  const signature = await account.signMessage({ message: challenge.message })
  const verified = await fetch(`${API_BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: account.address,
      message: challenge.message,
      nonce: challenge.nonce,
      signature,
    }),
  })
  const verifyBody = await verified.text()

  assert.equal(verified.status, 200, verifyBody)
  const sessionCookie = firstSetCookie(verified.headers)?.split(';')[0]
  if (!sessionCookie?.startsWith('zamapay_session=')) {
    throw new Error('wallet login did not mint zamapay_session cookie')
  }

  return {
    address: account.address,
    cookie: sessionCookie,
  }
}
