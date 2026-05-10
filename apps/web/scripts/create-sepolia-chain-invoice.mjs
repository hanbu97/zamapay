import { createSepoliaChainInvoiceDirect } from '../lib/sepolia-fhevm-server.ts'

const chunks = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const invoice = await createSepoliaChainInvoiceDirect({
    amountMinorUnits: BigInt(payload.amountMinorUnits),
    expiresInSeconds: payload.expiresInSeconds,
    externalRef: payload.externalRef,
    merchantNetMinorUnits: BigInt(payload.merchantNetMinorUnits),
    merchantOwnerAddress: payload.merchantOwnerAddress,
    platformFeeMinorUnits: BigInt(payload.platformFeeMinorUnits),
    settlementBucketSeed: payload.settlementBucketSeed,
  })

  process.stdout.write(`${JSON.stringify(invoice)}\n`)
} catch (caught) {
  const message = caught instanceof Error ? caught.message : 'Sepolia chain invoice creation failed.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
