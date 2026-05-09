import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contractEnvironmentForChainId,
  labelForProjectEnvironment,
  normalizeContractEnvironment,
} from '../lib/contract-environment.ts'

test('contract environment aliases resolve to the local-dev manifest', () => {
  assert.equal(normalizeContractEnvironment(undefined), 'local-dev')
  assert.equal(normalizeContractEnvironment('dev'), 'local-dev')
  assert.equal(normalizeContractEnvironment('local_dev'), 'local-dev')
  assert.throws(() => normalizeContractEnvironment('test'), /Unsupported contract environment/)
  assert.throws(() => normalizeContractEnvironment('testnet'), /Unsupported contract environment/)
  assert.throws(() => normalizeContractEnvironment('mainnet'), /Unsupported contract environment/)
})

test('contract environment maps chain ids and project labels', () => {
  assert.equal(contractEnvironmentForChainId(31337), 'local-dev')
  assert.equal(contractEnvironmentForChainId(11155111), null)
  assert.equal(contractEnvironmentForChainId(1), null)
  assert.equal(labelForProjectEnvironment('local_dev'), 'Local dev')
  assert.equal(labelForProjectEnvironment(null), 'No environment')
})
