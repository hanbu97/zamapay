import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addSettlementGasBuffer,
  estimateSettlementGas,
  selectBrowserFundingAction,
} from '../components/checkout/evm-funding.ts'
import type { EvmFundingAction, EvmFundingMethod } from '../lib/api.ts'

function action(
  method: EvmFundingMethod,
  rank: number,
  disabledReason: string | null = null,
  gasless = false,
): EvmFundingAction {
  return {
    method,
    rank,
    title: method,
    description: method,
    buttonLabel: method,
    contractFunction: method,
    gasless,
    requiresWalletSignature: method !== 'approve_pay',
    requiresTransaction: true,
    requiresTokenApproval: method === 'approve_pay' || method === 'permit2',
    approvalTarget: null,
    disabledReason,
    authorization: null,
  }
}

test('browser checkout chooses the first enabled low-interaction ERC20 action', () => {
  const selected = selectBrowserFundingAction([
    action('permit2', 20),
    action('eip3009', 10),
    action('erc2612', 30),
    action('approve_pay', 90),
  ])

  assert.equal(selected?.method, 'eip3009')
})

test('browser checkout prefers a relayed action when rank is otherwise tied', () => {
  const selected = selectBrowserFundingAction([
    action('eip3009', 10),
    action('eip3009', 10, null, true),
  ])

  assert.equal(selected?.gasless, true)
})

test('browser checkout uses Permit2 witness after EIP-3009 is unavailable', () => {
  const selected = selectBrowserFundingAction([
    action('eip3009', 10, 'payment intent is not open'),
    action('permit2', 20),
    action('approve_pay', 90),
  ])

  assert.equal(selected?.method, 'permit2')
})

test('browser checkout skips disabled methods and falls back to approve/pay', () => {
  const selected = selectBrowserFundingAction([
    action('eip3009', 10, 'payment intent is not open'),
    action('permit2', 20, 'payment intent is not open'),
    action('erc2612', 30, 'payment intent is not open'),
    action('approve_pay', 90),
  ])

  assert.equal(selected?.method, 'approve_pay')
})

test('browser checkout returns no action when every supported direct path is disabled', () => {
  const selected = selectBrowserFundingAction([
    action('eip3009', 10, 'payment intent is not open'),
    action('erc2612', 30, 'payment intent is not open'),
    action('approve_pay', 90, 'payment intent is not open'),
  ])

  assert.equal(selected, null)
})

test('settlement gas buffer rounds up to a twenty percent margin', () => {
  assert.equal(addSettlementGasBuffer(100_000n), 120_000n)
  assert.equal(addSettlementGasBuffer(100_001n), 120_002n)
})

test('settlement gas estimation falls back to wallet estimation when simulation fails', async () => {
  assert.equal(
    await estimateSettlementGas('eip3009', async () => {
      throw new Error('simulation reverted')
    }),
    350_000n,
  )
})

test('settlement gas estimation rejects pathological wallet estimates', async () => {
  assert.equal(await estimateSettlementGas('eip3009', async () => 21_000_000n), 350_000n)
  assert.equal(await estimateSettlementGas('approve_pay', async () => 130_000n), 156_000n)
})
