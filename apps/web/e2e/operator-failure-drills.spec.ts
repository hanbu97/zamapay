import assert from 'node:assert/strict'
import test from 'node:test'
import { loginCookie } from './support/auth.ts'
import { API_BASE_URL, operatorHeaders, postJson, readJson } from './support/http.ts'

type InvoiceRecord = {
  decryptPendingGuardTrips?: number
  decryptRequest?: {
    requestId: string
  } | null
  finalityConfirmations: number
  finalityThreshold: number
  invoiceId: string
  snapshot: {
    decryptJobStatus: string
    finalityStatus: string
    fulfillmentStatus: string
    paymentTruth: string
  }
  webhook?: {
    attemptCount: number
    status: string
  } | null
}

type OperatorDiagnostics = {
  decryptPendingGuardTrips?: number
  decryptTimeouts: number
  expiredInvoices?: number
  failedWebhooks: number
  frozenFulfillments: number
  indexerCursor?: {
    indexedInvoices: number
    latestChainInvoiceId?: number | null
    latestPaymentTxHash?: string | null
  }
  indexerStalled?: boolean
  operatorActionRequired: boolean
  operatorAuthRejections?: number
  reorgExceptions: number
  replayGuardFailures: number
}

function uniqueChainInvoiceId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000)
}

function localTxHash(chainInvoiceId: number) {
  return `0x${chainInvoiceId.toString(16).padStart(64, '0')}`
}

function atLeastOneMore(after: number | undefined, before: number | undefined, label: string) {
  assert.ok((after ?? 0) >= (before ?? 0) + 1, `${label} did not increase`)
}

async function createInvoice(cookie: string, chainInvoiceId: number, externalRef: string) {
  return postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/invoices`,
    {
      amountLabel: '42 cUSDT',
      amountMinorUnits: 42000000,
      chainInvoiceId,
      chainTxHash: localTxHash(chainInvoiceId - 1),
      externalRef,
      note: 'Operator failure drill target',
      title: `Ops drill ${externalRef}`,
    },
    { cookie },
  )
}

async function projectPaid(chainInvoiceId: number, payerAddress: string) {
  return postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/operator/chain-invoices/${chainInvoiceId}/payment-projection`,
    {
      payerAddress,
      paymentTxHash: localTxHash(chainInvoiceId),
    },
    operatorHeaders(),
  )
}

async function projectFinalitySafe(chainInvoiceId: number) {
  return postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/operator/chain-invoices/${chainInvoiceId}/confirmations`,
    {
      confirmations: 2,
      finalityThreshold: 2,
    },
    operatorHeaders(),
  )
}

async function projectWebhookFailure(chainInvoiceId: number) {
  return postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/operator/chain-invoices/${chainInvoiceId}/webhook-delivery`,
    {
      maxAttempts: 2,
      outcome: 'failed',
    },
    operatorHeaders(),
  )
}

async function projectSettlementEvent(chainInvoiceId: number, event: string) {
  return postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/operator/chain-invoices/${chainInvoiceId}/settlement-event`,
    {
      event,
      finalityThreshold: 2,
    },
    operatorHeaders(),
  )
}

async function diagnostics() {
  return readJson<OperatorDiagnostics>(`${API_BASE_URL}/api/operator/diagnostics`, {
    headers: operatorHeaders(),
  })
}

async function rejectOperatorAuth() {
  const response = await fetch(`${API_BASE_URL}/api/operator/diagnostics`, {
    headers: {
      'x-operator-key': 'invalid-operator-key',
    },
  })
  assert.equal(response.status, 401, await response.text())
}

test('operator-failure-drills e2e projects incidents and renders them in ops', async () => {
  const before = await diagnostics()
  const login = await loginCookie()

  const incidentChainId = uniqueChainInvoiceId()
  const incidentRef = `ops-failure-${incidentChainId}`
  await createInvoice(login.cookie, incidentChainId, incidentRef)
  await projectPaid(incidentChainId, login.address)
  const finalitySafe = await projectFinalitySafe(incidentChainId)
  assert.equal(finalitySafe.finalityConfirmations, 2)
  assert.equal(finalitySafe.finalityThreshold, 2)
  assert.equal(finalitySafe.snapshot.paymentTruth, 'paid')
  assert.equal(finalitySafe.snapshot.finalityStatus, 'finality_safe')
  assert.equal(finalitySafe.snapshot.fulfillmentStatus, 'ready')

  const retryScheduled = await projectWebhookFailure(incidentChainId)
  assert.equal(retryScheduled.webhook?.status, 'retry_scheduled')
  assert.equal(retryScheduled.webhook?.attemptCount, 1)
  const deadLetter = await projectWebhookFailure(incidentChainId)
  assert.equal(deadLetter.webhook?.status, 'dead_letter')
  assert.equal(deadLetter.webhook?.attemptCount, 2)

  const timedOut = await projectSettlementEvent(incidentChainId, 'decrypt_timeout')
  assert.equal(timedOut.snapshot.decryptJobStatus, 'failed_timeout')
  const deepReorg = await projectSettlementEvent(incidentChainId, 'deep_reorg_exception')
  assert.equal(deepReorg.snapshot.finalityStatus, 'reorg_exception')
  assert.equal(deepReorg.snapshot.fulfillmentStatus, 'frozen_for_manual_intervention')

  const replayChainId = uniqueChainInvoiceId()
  const replayRef = `ops-replay-${replayChainId}`
  await createInvoice(login.cookie, replayChainId, replayRef)
  await projectPaid(replayChainId, login.address)
  const replayGuard = await projectSettlementEvent(replayChainId, 'decrypt_replay_guard')
  assert.equal(replayGuard.snapshot.decryptJobStatus, 'failed_replay_guard')

  const expiredChainId = uniqueChainInvoiceId()
  const expiredRef = `ops-expired-${expiredChainId}`
  await createInvoice(login.cookie, expiredChainId, expiredRef)
  const expired = await projectSettlementEvent(expiredChainId, 'invoice_expired')
  assert.equal(expired.snapshot.paymentTruth, 'expired')
  assert.equal(expired.snapshot.finalityStatus, 'not_paid')
  assert.equal(expired.snapshot.fulfillmentStatus, 'not_ready')

  const rollbackChainId = uniqueChainInvoiceId()
  const rollbackRef = `ops-rollback-${rollbackChainId}`
  await createInvoice(login.cookie, rollbackChainId, rollbackRef)
  await projectPaid(rollbackChainId, login.address)
  const rolledBack = await projectSettlementEvent(rollbackChainId, 'rollback_before_threshold')
  assert.equal(rolledBack.finalityConfirmations, 0)
  assert.equal(rolledBack.finalityThreshold, 2)
  assert.equal(rolledBack.snapshot.paymentTruth, 'pending_payment')
  assert.equal(rolledBack.snapshot.finalityStatus, 'not_paid')
  assert.equal(rolledBack.snapshot.fulfillmentStatus, 'not_ready')

  const decryptChainId = uniqueChainInvoiceId()
  const decryptRef = `ops-decrypt-${decryptChainId}`
  const decryptInvoice = await createInvoice(login.cookie, decryptChainId, decryptRef)
  await projectPaid(decryptChainId, login.address)
  const firstDecrypt = await postJson<InvoiceRecord>(
    `${API_BASE_URL}/api/invoices/${decryptInvoice.invoiceId}/decrypt-request`,
    {},
    { cookie: login.cookie },
  )
  assert.equal(firstDecrypt.snapshot.decryptJobStatus, 'requested')

  const duplicateDecrypt = await fetch(`${API_BASE_URL}/api/invoices/${decryptInvoice.invoiceId}/decrypt-request`, {
    method: 'POST',
    headers: { cookie: login.cookie },
  })
  assert.equal(duplicateDecrypt.status, 409, await duplicateDecrypt.text())

  await rejectOperatorAuth()

  const after = await diagnostics()
  const latestDrillChainId = Math.max(incidentChainId, replayChainId, expiredChainId, rollbackChainId, decryptChainId)
  assert.equal(after.indexerStalled, true)
  assert.ok(
    (after.indexerCursor?.indexedInvoices ?? 0) >= (before.indexerCursor?.indexedInvoices ?? 0) + 5,
    'indexer cursor did not count newly indexed invoices',
  )
  assert.ok(
    (after.indexerCursor?.latestChainInvoiceId ?? 0) >= latestDrillChainId,
    'indexer cursor did not advance to the latest drill invoice',
  )
  atLeastOneMore(after.failedWebhooks, before.failedWebhooks, 'failed webhooks')
  atLeastOneMore(after.expiredInvoices, before.expiredInvoices, 'expired invoices')
  atLeastOneMore(after.decryptTimeouts, before.decryptTimeouts, 'decrypt timeouts')
  atLeastOneMore(after.replayGuardFailures, before.replayGuardFailures, 'replay guard failures')
  atLeastOneMore(after.reorgExceptions, before.reorgExceptions, 'reorg exceptions')
  atLeastOneMore(after.frozenFulfillments, before.frozenFulfillments, 'frozen fulfillments')
  atLeastOneMore(after.decryptPendingGuardTrips, before.decryptPendingGuardTrips, 'decrypt pending guard trips')
  atLeastOneMore(after.operatorAuthRejections, before.operatorAuthRejections, 'operator auth rejections')
  assert.equal(after.operatorActionRequired, true)
})
