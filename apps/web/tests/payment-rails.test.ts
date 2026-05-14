import assert from 'node:assert/strict'
import test from 'node:test'
import { paymentRailLabel, paymentRailShortLabel, projectPaymentRailSetting } from '../lib/payment-rails.ts'
import type { ProjectDashboardOverview } from '../lib/api.ts'

test('payment rail labels distinguish private and ERC20 receiving methods', () => {
  assert.equal(paymentRailLabel('zama_private'), 'Zama private')
  assert.equal(paymentRailShortLabel('evm_erc20'), 'ERC20')
})

test('project rail setting defaults existing projects to enabled', () => {
  const overview = {
    paymentRails: [],
    project: {
      createdAt: '2026-05-13T00:00:00Z',
      projectId: 'proj_1',
      updatedAt: '2026-05-13T00:00:00Z',
    },
  } as unknown as ProjectDashboardOverview

  assert.deepEqual(projectPaymentRailSetting(overview, 'evm_erc20'), {
    createdAt: '2026-05-13T00:00:00Z',
    enabled: true,
    paymentRail: 'evm_erc20',
    projectId: 'proj_1',
    updatedAt: '2026-05-13T00:00:00Z',
  })
})
