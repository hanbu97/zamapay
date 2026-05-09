import assert from 'node:assert/strict'
import test from 'node:test'
import { encryptLocalEuint64, publicDecryptLocalBool } from '../lib/local-fhevm-browser.ts'

function jsonResponse(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

test('local FHEVM browser encryption normalizes bare RPC hex handles', async (t) => {
  const originalFetch = globalThis.fetch
  const bareHandle = '5ebc9674dcf022d29d1888fa7b64bf383f8f293272000000000000007a690500'
  const bareSignature = 'aa'.repeat(65)

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string }

    if (body.method === 'fhevm_relayer_metadata') {
      return jsonResponse({ ACLAddress: '11'.repeat(20) })
    }
    if (body.method === 'fhevm_relayer_v1_input_proof') {
      return jsonResponse({ handles: [bareHandle], signatures: [bareSignature] })
    }

    throw new Error(`Unexpected RPC method ${body.method}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const encrypted = await encryptLocalEuint64({
    amountMinorUnits: 120_000_000n,
    chainId: 31337,
    contractAddress: `0x${'22'.repeat(20)}`,
    rpcUrl: 'http://127.0.0.1:8545',
    userAddress: `0x${'33'.repeat(20)}`,
  })

  assert.equal(encrypted.handle, `0x${bareHandle}`)
  assert.match(encrypted.inputProof, /^0x/)
  assert.ok(encrypted.inputProof.includes(bareHandle))
})

test('local FHEVM public decrypt normalizes bare RPC hex proof values', async (t) => {
  const originalFetch = globalThis.fetch
  const clearTrue = `${'0'.repeat(63)}1`
  const bareSignature = 'bb'.repeat(65)

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method?: string }

    if (body.method === 'fhevm_relayer_v1_public_decrypt') {
      return jsonResponse({ decrypted_value: clearTrue, signatures: [bareSignature] })
    }

    throw new Error(`Unexpected RPC method ${body.method}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const proof = await publicDecryptLocalBool('http://127.0.0.1:8545', `0x${'44'.repeat(32)}`)

  assert.equal(proof.accepted, true)
  assert.equal(proof.abiEncodedClearValues, `0x${clearTrue}`)
  assert.match(proof.decryptionProof, /^0x/)
  assert.ok(proof.decryptionProof.includes(bareSignature))
})
