const fs = require('fs')
const path = require('path')
const hre = require('hardhat')

const API_BASE_URL = process.env.MERMER_API_BASE_URL ?? 'http://127.0.0.1:8080'
const OPERATOR_KEY = process.env.MERMER_OPERATOR_KEY ?? 'local-operator-dev-key'
const PAYMENT_TX_HASH = process.env.PAYMENT_TX_HASH
const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? 2)
const FINALITY_THRESHOLD = Number(process.env.FINALITY_THRESHOLD ?? 2)

function manifestFileName(chainId) {
  return chainId === 11155111n ? 'sepolia.json' : 'local-dev.json'
}

function readManifest(chainId) {
  const file = path.resolve(
    __dirname,
    '..',
    '..',
    'generated',
    'contracts',
    'addresses',
    manifestFileName(chainId),
  )

  if (!fs.existsSync(file)) {
    throw new Error(`Contract manifest missing: ${file}`)
  }

  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

async function postJson(pathname, body) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${text}`)
  }

  return text ? JSON.parse(text) : null
}

function invoicePaidEvent(settlement, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log)

      if (parsed?.name === 'InvoicePaid') {
        return {
          chainInvoiceId: Number(parsed.args.invoiceId),
          merchantAddress: parsed.args.merchant,
          payerAddress: parsed.args.payer,
        }
      }
    } catch {
      continue
    }
  }

  throw new Error('InvoicePaid event not found in PAYMENT_TX_HASH receipt.')
}

function invoicePaymentSplitEvent(settlement, receipt, chainInvoiceId) {
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log)

      if (parsed?.name === 'InvoicePaymentSplit' && Number(parsed.args.invoiceId) === chainInvoiceId) {
        return {
          settledAmountHandle: parsed.args.settledAmountHandle,
          platformFeeAmountHandle: parsed.args.platformFeeAmountHandle,
        }
      }
    } catch {
      continue
    }
  }

  return null
}

async function main() {
  if (!PAYMENT_TX_HASH?.startsWith('0x')) {
    throw new Error('PAYMENT_TX_HASH=0x... is required. Use the finalizePayment transaction hash.')
  }

  const network = await hre.ethers.provider.getNetwork()
  const manifest = readManifest(network.chainId)
  const settlementAddress = manifest.contracts?.ConfidentialInvoiceSettlement

  if (!settlementAddress?.startsWith('0x')) {
    throw new Error('ConfidentialInvoiceSettlement is missing from the selected manifest.')
  }

  const receipt = await hre.ethers.provider.getTransactionReceipt(PAYMENT_TX_HASH)

  if (!receipt) {
    throw new Error(`Transaction receipt not found: ${PAYMENT_TX_HASH}`)
  }

  const settlement = await hre.ethers.getContractAt('ConfidentialInvoiceSettlement', settlementAddress)
  const paid = invoicePaidEvent(settlement, receipt)
  const split = invoicePaymentSplitEvent(settlement, receipt, paid.chainInvoiceId)
  const projected = await postJson(
    `/api/operator/chain-invoices/${paid.chainInvoiceId}/payment-projection`,
    {
      paymentTxHash: PAYMENT_TX_HASH,
      payerAddress: paid.payerAddress,
    },
  )
  const finality = await postJson(
    `/api/operator/chain-invoices/${paid.chainInvoiceId}/confirmations`,
    {
      confirmations: CONFIRMATIONS,
      finalityThreshold: FINALITY_THRESHOLD,
    },
  )

  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        chainId: Number(network.chainId),
        paymentTxHash: PAYMENT_TX_HASH,
        chainInvoiceId: paid.chainInvoiceId,
        settledAmountHandle: split?.settledAmountHandle ?? null,
        platformFeeAmountHandle: split?.platformFeeAmountHandle ?? null,
        payerAddress: paid.payerAddress,
        merchantAddress: paid.merchantAddress,
        projectedInvoiceId: projected.invoiceId,
        paymentTruth: projected.snapshot.paymentTruth,
        finalityStatus: finality.snapshot.finalityStatus,
        finalityConfirmations: finality.finalityConfirmations,
        finalityThreshold: finality.finalityThreshold,
        fulfillmentStatus: finality.snapshot.fulfillmentStatus,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
