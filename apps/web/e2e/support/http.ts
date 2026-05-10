export const API_BASE_URL = process.env.ZAMAPAY_API_BASE_URL ?? 'http://127.0.0.1:8080'
export const WEB_BASE_URL = process.env.ZAMAPAY_WEB_BASE_URL ?? 'http://127.0.0.1:3001'
export const OPERATOR_KEY = process.env.ZAMAPAY_OPERATOR_KEY ?? 'local-operator-dev-key'

export async function readText(url: string, options: RequestInit = {}) {
  const response = await fetch(url, options)
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${body}`)
  }

  return body
}

export async function readJson<T>(url: string, options: RequestInit = {}) {
  return JSON.parse(await readText(url, options)) as T
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}) {
  return readJson<T>(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

export function operatorHeaders() {
  return {
    'x-operator-key': OPERATOR_KEY,
  }
}
