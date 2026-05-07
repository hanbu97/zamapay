const fs = require('fs')
const path = require('path')
const hre = require('hardhat')

const API_BASE_URL = process.env.MERMER_API_BASE_URL ?? 'http://127.0.0.1:8080'

function readManifest() {
  const manifestPath = path.resolve(__dirname, '..', '..', 'generated', 'contracts', 'addresses', 'local-dev.json')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

async function readJson(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function postJson(pathname, body, headers = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${await response.text()}`)
  }

  return {
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
    json: await readJson(response),
  }
}

async function getJson(pathname, headers = {}) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    headers,
  })

  if (!response.ok) {
    throw new Error(`${pathname} failed with ${response.status}: ${await response.text()}`)
  }

  return readJson(response)
}

function invoiceCreatedId(settlement, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log)
      if (parsed?.name === 'InvoiceCreated') {
        return Number(parsed.args.invoiceId)
      }
    } catch {
      continue
    }
  }

  throw new Error('InvoiceCreated event not found')
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

  throw new Error('InvoicePaid event not found')
}

function invoicePaymentSubmittedEvent(settlement, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log)
      if (parsed?.name === 'InvoicePaymentSubmitted') {
        return {
          chainInvoiceId: Number(parsed.args.invoiceId),
          merchantAddress: parsed.args.merchant,
          payerAddress: parsed.args.payer,
          paymentCheckHandle: parsed.args.paymentCheckHandle,
        }
      }
    } catch {
      continue
    }
  }

  throw new Error('InvoicePaymentSubmitted event not found')
}

async function main() {
  const { ethers } = hre
  const [merchant, buyer] = await ethers.getSigners()
  const merchantAddress = await merchant.getAddress()
  const buyerAddress = await buyer.getAddress()
  const manifest = readManifest()
  const registryAddress = manifest.contracts.MerchantRegistry
  const tokenAddress = manifest.contracts.ConfidentialUSDMock
  const settlementAddress = manifest.contracts.ConfidentialInvoiceSettlement

  if (!registryAddress || !tokenAddress || !settlementAddress) {
    throw new Error('local-dev manifest does not contain deployed contract addresses')
  }

  const registry = await ethers.getContractAt('MerchantRegistry', registryAddress)
  const token = await ethers.getContractAt('ConfidentialUSDMock', tokenAddress)
  const settlement = await ethers.getContractAt('ConfidentialInvoiceSettlement', settlementAddress)
  const amountDue = 120000000n

  if (!(await registry.isMerchant(merchantAddress))) {
    await (await registry.registerMerchant(merchantAddress, 'Mermer Demo Merchant')).wait()
  }

  await (await token.mint(buyerAddress, amountDue)).wait()

  const externalRef = `smoke-${Date.now()}`
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60
  const createTx = await settlement.createInvoice(externalRef, expiresAt, amountDue)
  const receipt = await createTx.wait()
  const chainInvoiceId = invoiceCreatedId(settlement, receipt)

  const challenge = (await postJson('/api/auth/nonce', { address: merchantAddress })).json
  const signature = await merchant.signMessage(challenge.message)
  const verified = await postJson('/api/auth/verify', {
    address: merchantAddress,
    nonce: challenge.nonce,
    message: challenge.message,
    signature,
  })

  if (!verified.cookie) {
    throw new Error('API verify did not return a session cookie')
  }

  const projected = await postJson(
    '/api/invoices',
    {
      title: 'Local smoke card-code bundle',
      amountLabel: '120 cUSDT',
      amountMinorUnits: Number(amountDue),
      note: 'Created by local contract smoke script.',
      externalRef,
      chainInvoiceId,
      chainTxHash: createTx.hash,
    },
    { cookie: verified.cookie },
  )

  await hre.fhevm.initializeCLIApi()
  await hre.fhevm.assertCoprocessorInitialized(settlement, 'ConfidentialInvoiceSettlement')
  await hre.fhevm.assertCoprocessorInitialized(token, 'ConfidentialUSDMock')

  const approvalInput = hre.fhevm.createEncryptedInput(tokenAddress, buyerAddress)
  approvalInput.add64(amountDue)
  const encryptedApproval = await approvalInput.encrypt()
  await token.connect(buyer).approve(settlementAddress, encryptedApproval.handles[0], encryptedApproval.inputProof)

  const encryptedInput = hre.fhevm.createEncryptedInput(settlementAddress, buyerAddress)
  encryptedInput.add64(amountDue)
  const encryptedPayment = await encryptedInput.encrypt()
  const payTx = await settlement
    .connect(buyer)
    .payInvoice(chainInvoiceId, encryptedPayment.handles[0], encryptedPayment.inputProof)
  const payReceipt = await payTx.wait()
  const submittedEvent = invoicePaymentSubmittedEvent(settlement, payReceipt)

  if (submittedEvent.chainInvoiceId !== chainInvoiceId) {
    throw new Error(`InvoicePaymentSubmitted id mismatch: expected ${chainInvoiceId}, got ${submittedEvent.chainInvoiceId}`)
  }

  const paymentProof = await hre.fhevm.publicDecrypt([submittedEvent.paymentCheckHandle])
  const accepted = paymentProof.clearValues[submittedEvent.paymentCheckHandle]

  if (accepted !== true) {
    throw new Error(`Payment proof rejected local smoke payment: ${accepted}`)
  }

  const finalizeTx = await settlement.finalizePayment(
    chainInvoiceId,
    paymentProof.abiEncodedClearValues,
    paymentProof.decryptionProof,
  )
  const finalizeReceipt = await finalizeTx.wait()
  const paidEvent = invoicePaidEvent(settlement, finalizeReceipt)

  if (paidEvent.chainInvoiceId !== chainInvoiceId) {
    throw new Error(`InvoicePaid id mismatch: expected ${chainInvoiceId}, got ${paidEvent.chainInvoiceId}`)
  }

  const paid = await postJson(
    `/api/operator/chain-invoices/${paidEvent.chainInvoiceId}/payment-projection`,
    {
      paymentTxHash: finalizeTx.hash,
      payerAddress: paidEvent.payerAddress,
    },
    { 'x-operator-key': process.env.MERMER_OPERATOR_KEY ?? 'local-operator-dev-key' },
  )
  const finalityProjection = await postJson(
    `/api/operator/chain-invoices/${paidEvent.chainInvoiceId}/confirmations`,
    {
      confirmations: 2,
      finalityThreshold: 2,
    },
    { 'x-operator-key': process.env.MERMER_OPERATOR_KEY ?? 'local-operator-dev-key' },
  )
  const fulfillment = await getJson(`/api/invoices/${externalRef}/fulfillment`)

  console.log(
    JSON.stringify(
      {
        externalRef,
        chainInvoiceId,
        chainTxHash: createTx.hash,
        paymentSubmissionTxHash: payTx.hash,
        paymentTxHash: finalizeTx.hash,
        paymentTruth: paid.json.snapshot.paymentTruth,
        finalityStatus: finalityProjection.json.snapshot.finalityStatus,
        finalityConfirmations: finalityProjection.json.finalityConfirmations,
        finalityThreshold: finalityProjection.json.finalityThreshold,
        fulfillmentDecision: fulfillment.decision,
        artifactCount: fulfillment.artifacts.length,
        projectedInvoiceId: projected.json.invoiceId,
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
