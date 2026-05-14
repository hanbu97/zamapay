import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProjectDashboardOverview } from '../lib/api.ts'
import {
  formatCheckoutAmountForProject,
  formatCheckoutFeeForProject,
  formatProjectMinorUnits,
} from '../lib/project-amounts.ts'

test('project amount formatter keeps ERC20 token context on checkout and balances', () => {
  const session = {
    amountMinorUnits: 1_000_000,
    billing: { platformFeeMinorUnits: 5_000 },
    checkoutSessionId: 'cs_erc20',
    paymentRail: 'evm_erc20',
  } as ProjectDashboardOverview['checkoutSessions'][number]
  const overview = {
    checkoutSessions: [session],
    evmAssetBalances: [
      {
        confirmedMinorUnits: 1_000_000,
        exceptionMinorUnits: 0,
        pendingMinorUnits: 0,
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
        withdrawableMinorUnits: 995_000,
      },
    ],
    evmPaymentIntents: [
      {
        checkoutSessionId: 'cs_erc20',
        tokenDecimals: 6,
        tokenSymbol: 'USDT',
      },
    ],
  } as unknown as ProjectDashboardOverview

  assert.equal(formatCheckoutAmountForProject(session, overview), '1.00 USDT')
  assert.equal(formatCheckoutFeeForProject(session, overview), '0.005 USDT')
  assert.equal(formatProjectMinorUnits(995_000, overview), '0.995 USDT')
})

test('project amount formatter keeps private rail on cUSDT labels', () => {
  const session = {
    amountMinorUnits: 995_000,
    billing: { platformFeeMinorUnits: 5_000 },
    checkoutSessionId: 'cs_private',
    paymentRail: 'zama_private',
  } as ProjectDashboardOverview['checkoutSessions'][number]
  const overview = {
    checkoutSessions: [session],
    evmAssetBalances: [],
    evmPaymentIntents: [],
  } as unknown as ProjectDashboardOverview

  assert.equal(formatCheckoutAmountForProject(session, overview), '0.995 cUSDT')
  assert.equal(formatCheckoutFeeForProject(session, overview), '0.005 cUSDT')
  assert.equal(formatProjectMinorUnits(995_000, overview), '0.995 cUSDT')
})
