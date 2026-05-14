import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createPublicClient, createWalletClient, getAddress, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const API_BASE_URL = cleanBaseUrl(process.env.ZAMAPAY_API_URL ?? 'http://127.0.0.1:18080')
const WEB_BASE_URL = cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL ?? process.env.ZAMAPAY_CHECKOUT_BASE_URL ?? 'http://127.0.0.1:3001')
const RPC_URL = process.env.ZAMAPAY_LOCAL_EVM_RPC_URL ?? 'http://127.0.0.1:8545'
const MERCHANT_PRIVATE_KEY =
  process.env.ZAMAPAY_LOCAL_LOGIN_PRIVATE_KEY ??
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const BUYER_PRIVATE_KEY =
  process.env.ZAMAPAY_LOCAL_EVM_BUYER_PRIVATE_KEY ??
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const TOKEN_SYMBOL = argValue('--token') ?? 'USDT'
const AMOUNT_MINOR_UNITS = Number.parseInt(argValue('--amount-minor-units') ?? '12000000', 10)
const PREPARE_ONLY = process.argv.includes('--prepare-only')
const CHECKOUT_ID = argValue('--checkout-id')

const erc20Abi = parseAbi([
  'function claimTestTokens() returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
])
const settlementAbi = parseAbi([
  'function pay(bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt)',
])

const hardhatLocal = {
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: { default: { http: [RPC_URL] } },
}

function cleanBaseUrl(value) {
  return value.trim().replace(/\/+$/, '')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${body}`)
  }

  return body ? JSON.parse(body) : null
}

function firstSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()[0]
  }

  return headers.get('set-cookie')
}

async function loginCookie() {
  const merchant = privateKeyToAccount(MERCHANT_PRIVATE_KEY)
  const challenge = await apiJson('/api/auth/nonce', {
    method: 'POST',
    body: JSON.stringify({ address: merchant.address }),
  })
  const signature = await merchant.signMessage({ message: challenge.message })
  const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: merchant.address,
      message: challenge.message,
      nonce: challenge.nonce,
      signature,
    }),
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`/api/auth/verify failed with ${response.status}: ${body}`)
  }

  const setCookie = firstSetCookie(response.headers)
  assert(setCookie?.startsWith('zamapay_session='), 'login did not return a zamapay_session cookie')

  return {
    address: merchant.address,
    cookie: setCookie.split(';')[0],
  }
}

async function createCheckout() {
  const merchant = await loginCookie()
  const project = await apiJson('/api/projects', {
    method: 'POST',
    headers: { cookie: merchant.cookie },
    body: JSON.stringify({
      environment: 'local_dev',
      name: `Local EVM ERC20 ${new Date().toISOString()}`,
    }),
  })
  const projectSecret = await apiJson(`/api/projects/${project.project.projectId}/project-secrets`, {
    method: 'POST',
    headers: { cookie: merchant.cookie },
    body: JSON.stringify({
      environment: 'local_dev',
      label: 'Local EVM verifier',
    }),
  })
  const checkout = await apiJson(`/api/projects/${project.project.projectId}/checkout-sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${projectSecret.secretKey}`,
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({
      amountLabel: `${formatTokenAmount(AMOUNT_MINOR_UNITS, 6)} ${TOKEN_SYMBOL.toUpperCase()}`,
      amountMinorUnits: AMOUNT_MINOR_UNITS,
      cancelUrl: `${WEB_BASE_URL}/merchant`,
      evmChainId: 31337,
      evmTokenSymbol: TOKEN_SYMBOL,
      merchantOrderId: `local-evm-${Date.now()}`,
      metadata: { verifier: 'local-evm-erc20' },
      note: 'Local ordinary ERC20 rail verification',
      paymentRail: 'evm_erc20',
      successUrl: `${WEB_BASE_URL}/merchant`,
      title: `Local ${TOKEN_SYMBOL.toUpperCase()} checkout`,
    }),
  })

  assert(checkout.paymentRail === 'evm_erc20', 'checkout did not use evm_erc20 rail')
  assert(checkout.evmPaymentIntent, 'checkout response did not include an EVM payment intent')
  assert(checkout.chainInvoiceId === null, 'EVM checkout must not allocate a Zama chain invoice')
  assert(checkout.chainTxHash === null, 'EVM checkout must not require a chain tx hash')

  return {
    checkout,
    merchant,
    projectId: project.project.projectId,
  }
}

async function loadCheckout(checkoutId) {
  const publicCheckout = await apiJson(`/api/checkout/${checkoutId}`)
  assert(publicCheckout.evmPaymentIntent, 'public checkout is missing an EVM payment intent')

  return {
    checkout: {
      ...publicCheckout.session,
      evmPaymentIntent: publicCheckout.evmPaymentIntent,
    },
    merchant: await loginCookie(),
    projectId: publicCheckout.invoice.projectId,
  }
}

async function assertHostedCheckoutRenders(checkoutUrl) {
  const response = await fetch(checkoutUrl)
  const html = await response.text()

  if (!response.ok) {
    throw new Error(`${checkoutUrl} failed with ${response.status}: ${html.slice(0, 240)}`)
  }

  assert(html.includes('ERC20 hosted checkout'), 'hosted checkout did not render the ERC20 rail badge')
  assert(html.includes('Pay through settlement'), 'hosted checkout did not render the ERC20 settlement action')
}

async function payCheckout(checkout) {
  const intent = checkout.evmPaymentIntent
  const buyer = privateKeyToAccount(BUYER_PRIVATE_KEY)
  const publicClient = createPublicClient({ chain: hardhatLocal, transport: http(RPC_URL) })
  const walletClient = createWalletClient({
    account: buyer,
    chain: hardhatLocal,
    transport: http(RPC_URL),
  })
  const token = getAddress(intent.tokenContract)
  const settlement = getAddress(intent.settlementContract)

  const claimHash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'claimTestTokens',
  })
  await publicClient.waitForTransactionReceipt({ hash: claimHash })

  const balance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [buyer.address],
  })
  assert(balance >= BigInt(intent.expectedAmountMinorUnits), 'buyer token balance is lower than checkout amount')

  const approveHash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [settlement, BigInt(intent.expectedAmountMinorUnits)],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })

  const paymentHash = await walletClient.writeContract({
    address: settlement,
    abi: settlementAbi,
    functionName: 'pay',
    args: [
      intent.settlementIntentId,
      intent.settlementProjectId,
      token,
      BigInt(intent.expectedAmountMinorUnits),
      BigInt(intent.merchantNetMinorUnits),
      BigInt(intent.platformFeeMinorUnits),
      BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000)),
    ],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: paymentHash })

  return {
    approveHash,
    buyer: buyer.address,
    paymentHash,
    settlement,
    token,
    paymentBlock: Number(receipt.blockNumber),
  }
}

async function runIndexerOnce() {
  const output = await runProcess(process.execPath, ['scripts/evm-erc20-indexer.mjs', '--once'])
  const lastLine = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .at(-1)
  const parsed = lastLine ? JSON.parse(lastLine) : null

  assert(parsed?.assets >= 1, 'indexer watchlist did not include the open EVM intent')
  assert(parsed?.projected >= 1, 'indexer did not project the ERC20 settlement event')

  return parsed
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(new Error(`${command} ${args.join(' ')} failed with ${code}: ${stderr || stdout}`))
    })
  })
}

async function pollPaid(checkoutId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const publicCheckout = await apiJson(`/api/checkout/${checkoutId}`)
    if (
      publicCheckout.invoice.snapshot.paymentTruth === 'paid' &&
      publicCheckout.invoice.snapshot.finalityStatus === 'finality_safe'
    ) {
      return publicCheckout
    }

    await delay(500)
  }

  throw new Error(`checkout ${checkoutId} did not reach paid/finality_safe`)
}

async function loadOverview(projectId, cookie) {
  return apiJson(`/api/projects/${projectId}`, {
    headers: { cookie },
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function formatTokenAmount(minorUnits, decimals) {
  const whole = Math.floor(minorUnits / 10 ** decimals)
  const fraction = String(minorUnits % 10 ** decimals).padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

async function main() {
  assert(Number.isSafeInteger(AMOUNT_MINOR_UNITS) && AMOUNT_MINOR_UNITS > 0, '--amount-minor-units must be positive')

  const setup = CHECKOUT_ID ? await loadCheckout(CHECKOUT_ID) : await createCheckout()
  await assertHostedCheckoutRenders(setup.checkout.checkoutUrl)

  const prepared = {
    checkoutId: setup.checkout.checkoutSessionId,
    checkoutUrl: setup.checkout.checkoutUrl,
    intentId: setup.checkout.evmPaymentIntent.intentId,
    projectId: setup.projectId,
    settlementContract: setup.checkout.evmPaymentIntent.settlementContract,
    settlementIntentId: setup.checkout.evmPaymentIntent.settlementIntentId,
    tokenContract: setup.checkout.evmPaymentIntent.tokenContract,
  }

  if (PREPARE_ONLY) {
    console.log(JSON.stringify({ ok: true, mode: 'prepare-only', ...prepared }, null, 2))
    return
  }

  const payment = await payCheckout(setup.checkout)
  const indexer = await runIndexerOnce()
  const publicCheckout = await pollPaid(setup.checkout.checkoutSessionId)
  const overview = await loadOverview(setup.projectId, setup.merchant.cookie)
  const balance = overview.evmAssetBalances.find(
    (entry) =>
      entry.chainId === setup.checkout.evmPaymentIntent.chainId &&
      entry.tokenContract.toLowerCase() === setup.checkout.evmPaymentIntent.tokenContract.toLowerCase(),
  )
  const ledger = overview.evmTransferLedger.find(
    (entry) => entry.txHash.toLowerCase() === payment.paymentHash.toLowerCase(),
  )

  assert(ledger?.status === 'confirmed', `expected confirmed settlement ledger entry, got ${ledger?.status}`)
  assert(balance?.confirmedMinorUnits >= setup.checkout.evmPaymentIntent.expectedAmountMinorUnits, 'confirmed EVM balance did not include settlement')

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...prepared,
        buyer: payment.buyer,
        finalityStatus: publicCheckout.invoice.snapshot.finalityStatus,
        indexer,
        ledgerStatus: ledger.status,
        paymentTruth: publicCheckout.invoice.snapshot.paymentTruth,
        paymentBlock: payment.paymentBlock,
        paymentHash: payment.paymentHash,
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
