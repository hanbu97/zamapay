import assert from 'node:assert/strict'
import test from 'node:test'
import { formatMerchantTimestamp } from '../lib/time-format.ts'

test('merchant timestamp uses 00 hour for midnight instead of 12 AM', () => {
  const value = new Date(2026, 4, 10, 0, 14)

  assert.equal(formatMerchantTimestamp(value), 'May 10, 00:14 am')
})

test('merchant timestamp keeps afternoon hours numeric and lowercase', () => {
  const value = new Date(2026, 4, 10, 15, 5)

  assert.equal(formatMerchantTimestamp(value), 'May 10, 15:05 pm')
})
