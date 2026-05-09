import assert from 'node:assert/strict'
import test from 'node:test'
import { disconnectWalletAccounts, parseWalletAccounts, type EthereumProvider } from '../lib/wallet.ts'

test('wallet account parsing accepts only provider string accounts', () => {
  assert.deepEqual(parseWalletAccounts(['0xabc', 42, null, '0xdef']), ['0xabc', '0xdef'])
  assert.deepEqual(parseWalletAccounts({ 0: '0xabc' }), [])
  assert.deepEqual(parseWalletAccounts(undefined), [])
})

test('disconnect wallet accounts revokes site permission', async () => {
  const calls: string[] = []
  const provider: EthereumProvider = {
    async request(args) {
      calls.push(args.method)

      return null
    },
  }

  await disconnectWalletAccounts(provider)
  assert.deepEqual(calls, ['wallet_revokePermissions'])
})

test('disconnect wallet accounts ignores unsupported revoke method', async () => {
  const calls: string[] = []
  const provider: EthereumProvider = {
    async request(args) {
      calls.push(args.method)

      if (args.method === 'wallet_revokePermissions') {
        throw { code: -32601 }
      }

      return null
    },
  }

  await disconnectWalletAccounts(provider)
  assert.deepEqual(calls, ['wallet_revokePermissions'])
})
