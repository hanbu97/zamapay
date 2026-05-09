import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { loginCookie } from './support/auth.ts'
import { readJson, readText, WEB_BASE_URL } from './support/http.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function parseSmokeJson(stdout: string) {
  const match = stdout.match(/\{\s*"externalRef"[\s\S]*\}\s*$/)
  assert.ok(match, 'smoke:local-invoice did not print its final JSON report')
  return JSON.parse(match[0]) as {
    artifactCount: number
    externalRef: string
    finalityStatus: string
    merchantNetMinorUnits: number
    paymentTruth: string
    paymentTxHash: string
    platformFeeMinorUnits: number
  }
}

function runLocalPaymentSmoke() {
  const result = spawnSync('npm', ['run', 'smoke:local-invoice'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const smoke = parseSmokeJson(result.stdout)
  assert.equal(smoke.paymentTruth, 'paid')
  assert.equal(smoke.finalityStatus, 'finality_safe')
  assert.equal(smoke.artifactCount, 0)
  assert.equal(smoke.platformFeeMinorUnits, 600000)
  assert.equal(smoke.merchantNetMinorUnits, 119400000)
  assert.match(smoke.paymentTxHash, /^0x[0-9a-fA-F]+$/)
  return smoke
}

test('checkout-flow e2e projects local confidential payment and renders platform checkout state', async () => {
  const login = await loginCookie()
  const platform = await readText(`${WEB_BASE_URL}/merchant`, {
    headers: { cookie: login.cookie },
  })
  assert.match(platform, /Payment projects/)

  const smoke = runLocalPaymentSmoke()
  const projection = await readJson<{
    finality?: {
      finalityConfirmations?: number
      finalityThreshold?: number
      snapshot?: { finalityStatus?: string; paymentTruth?: string }
    }
  }>(
    `${WEB_BASE_URL}/api/checkout/project-finalized-payment`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentTxHash: smoke.paymentTxHash }),
    },
  )

  assert.equal(projection.finality?.snapshot?.paymentTruth, 'paid')
  assert.equal(projection.finality?.snapshot?.finalityStatus, 'finality_safe')
  assert.equal(projection.finality?.finalityConfirmations, 2)
  assert.equal(projection.finality?.finalityThreshold, 2)

  const checkout = await readText(`${WEB_BASE_URL}/checkout/${smoke.externalRef}`)
  assert.match(checkout, /Secure hosted checkout/)
  assert.match(checkout, /Payment verified/)
  assert.match(checkout, /Amount due/)
  assert.doesNotMatch(checkout, /Chain invoice/)
  assert.doesNotMatch(checkout, /Mermer Pay fee/)
  assert.doesNotMatch(checkout, /Merchant receives/)
  assert.doesNotMatch(checkout, /Finality depth/)
  assert.doesNotMatch(checkout, /MER-/)
  assert.doesNotMatch(checkout, /Release job/)
})
