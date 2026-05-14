import assert from 'node:assert/strict'
import test from 'node:test'
import { formatMinorTokenUnits, formatTokenUnits, formatUnits } from '../lib/amount-format.ts'

test('minor token formatter keeps merchant net precision visible', () => {
  assert.equal(formatMinorTokenUnits(995000), '0.995 cUSDT')
  assert.equal(formatMinorTokenUnits(5000), '0.005 cUSDT')
  assert.equal(formatMinorTokenUnits(1000000), '1.00 cUSDT')
})

test('token formatter supports ERC20 token symbols and exact decimals', () => {
  assert.equal(formatTokenUnits(1000000, 6, { symbol: 'USDT' }), '1.00 USDT')
  assert.equal(formatTokenUnits(1234567, 6, { symbol: 'USDC' }), '1.234567 USDC')
  assert.equal(formatTokenUnits(995000, 6), '0.995')
})

test('unit formatter handles bigint values and dust without displaying zero', () => {
  assert.equal(formatMinorTokenUnits(1234567890123n), '1,234,567.890123 cUSDT')
  assert.equal(formatUnits(1n, 18), '<0.000001')
  assert.equal(formatUnits(-1n, 18), '-<0.000001')
})
