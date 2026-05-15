import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createPublicClient, createWalletClient, getAddress, hexToSignature, http, parseAbi } from 'viem'
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
const FUNDING_METHOD = normalizeFundingMethod(argValue('--funding-method') ?? argValue('--payment-mode') ?? 'approve-pay')
const PREPARE_ONLY = process.argv.includes('--prepare-only')
const WITHDRAW_PROOF = process.argv.includes('--withdraw-proof')
const CHECKOUT_ID = argValue('--checkout-id')

const erc20Abi = parseAbi([
  'function claimTestTokens() returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
])
const settlementAbi = parseAbi([
  'function pay(bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt)',
  'function payWithAuthorization((bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt) params, (address payer, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) authorization)',
  'function payWithPermit2((bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt) params, (address permit2, address payer, ((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes32 witness, string witnessTypeString, bytes signature) permit2Payment)',
  'function payWithPermit((bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt) params, (uint256 deadline, uint8 v, bytes32 r, bytes32 s) permit)',
  'function merchantBalanceOf(bytes32 projectId, address token) view returns (uint256)',
  'function platformBalanceOf(address token) view returns (uint256)',
  'function paymentAuthorizationHash((bytes32 intentId, bytes32 projectId, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount, uint256 expiresAt) params, address payer, uint256 deadline) view returns (bytes32)',
  'function PERMIT2_PAYMENT_WITNESS_TYPE_STRING() view returns (string)',
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

function normalizeFundingMethod(value) {
  const normalized = value.replace(/_/g, '-').toLowerCase()
  const aliases = {
    approve: 'approve-pay',
    authorization: 'eip3009',
    gasless: 'relayed-eip3009',
    permit: 'erc2612',
    relayed: 'relayed-eip3009',
    'permit2-relayed': 'relayed-permit2',
  }
  const method = aliases[normalized] ?? normalized
  const allowed = new Set(['approve-pay', 'eip3009', 'relayed-eip3009', 'permit2', 'relayed-permit2', 'erc2612', 'all'])
  assert(
    allowed.has(method),
    '--funding-method must be approve-pay, eip3009, relayed-eip3009, permit2, relayed-permit2, erc2612, or all',
  )
  return method
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

async function webJson(path, options = {}) {
  const response = await fetch(`${WEB_BASE_URL}${path}`, {
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
  assert(html.includes('Pay with best available method'), 'hosted checkout did not render the ERC20 payment action')
}

async function payCheckout(checkout, fundingMethod) {
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
  const params = settlementPaymentParams(intent, token)

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

  const before = await settlementBalanceSnapshot(publicClient, settlement, token, intent)
  const { approveHash, paymentHash, relayerAddress = null } = await submitPaymentByFundingMethod({
    buyer,
    checkoutId: checkout.checkoutSessionId,
    fundingMethod,
    intent,
    params,
    publicClient,
    settlement,
    token,
    walletClient,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: paymentHash })
  await assertOnchainSettlementBalances(publicClient, settlement, token, intent, before)

  return {
    approveHash,
    buyer: buyer.address,
    fundingMethod,
    paymentHash,
    relayerAddress,
    settlement,
    token,
    paymentBlock: Number(receipt.blockNumber),
  }
}

async function submitPaymentByFundingMethod({
  buyer,
  checkoutId,
  fundingMethod,
  intent,
  params,
  publicClient,
  settlement,
  token,
  walletClient,
}) {
  if (fundingMethod === 'eip3009' || fundingMethod === 'relayed-eip3009') {
    const { authorization, signature } = await signEip3009Authorization({
      buyer,
      intent,
      params,
      publicClient,
      settlement,
      token,
    })

    if (fundingMethod === 'relayed-eip3009') {
      const relayed = await webJson(`/api/checkout/${checkoutId}/evm-relay`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'eip3009',
          payerAddress: buyer.address,
          signature,
        }),
      })

      return {
        approveHash: null,
        paymentHash: relayed.chainTxHash,
        relayerAddress: relayed.relayerAddress,
      }
    }

    const paymentHash = await walletClient.writeContract({
      address: settlement,
      abi: settlementAbi,
      functionName: 'payWithAuthorization',
      args: [params, authorization],
    })
    return { approveHash: null, paymentHash }
  }

  if (fundingMethod === 'erc2612') {
    const deadline = BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000))
    const nonce = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'nonces',
      args: [buyer.address],
    })
    const tokenName = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' })
    const signature = await buyer.signTypedData({
      domain: {
        chainId: hardhatLocal.id,
        name: tokenName,
        verifyingContract: token,
        version: '1',
      },
      primaryType: 'Permit',
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      message: {
        owner: buyer.address,
        spender: settlement,
        value: params.grossAmount,
        nonce,
        deadline,
      },
    })
    const split = hexToSignature(signature)
    const paymentHash = await walletClient.writeContract({
      address: settlement,
      abi: settlementAbi,
      functionName: 'payWithPermit',
      args: [params, { deadline, v: Number(split.v), r: split.r, s: split.s }],
    })
    return { approveHash: null, paymentHash }
  }

  if (fundingMethod === 'permit2' || fundingMethod === 'relayed-permit2') {
    const action = await evmFundingAction(checkoutId, buyer.address, 'permit2')
    const permit2Args = permit2PaymentArgs(action)
    const approveHash = await ensureTokenApproval({
      amount: params.grossAmount,
      publicClient,
      spender: permit2Args.permit2,
      token,
      walletClient,
      owner: buyer.address,
    })
    const signature = await buyer.signTypedData(normalizeTypedData(action.authorization.typedData))

    if (fundingMethod === 'relayed-permit2') {
      const relayed = await webJson(`/api/checkout/${checkoutId}/evm-relay`, {
        method: 'POST',
        body: JSON.stringify({
          method: 'permit2',
          payerAddress: buyer.address,
          signature,
        }),
      })

      return {
        approveHash,
        paymentHash: relayed.chainTxHash,
        relayerAddress: relayed.relayerAddress,
      }
    }

    const paymentHash = await walletClient.writeContract({
      address: settlement,
      abi: settlementAbi,
      functionName: 'payWithPermit2',
      args: [
        params,
        {
          ...permit2Args,
          signature,
        },
      ],
    })
    return { approveHash, paymentHash }
  }

  const approveHash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [settlement, params.grossAmount],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })

  const paymentHash = await walletClient.writeContract({
    address: settlement,
    abi: settlementAbi,
    functionName: 'pay',
    args: [
      params.intentId,
      params.projectId,
      params.token,
      params.grossAmount,
      params.merchantNetAmount,
      params.platformFeeAmount,
      params.expiresAt,
    ],
  })
  return { approveHash, paymentHash }
}

async function evmFundingAction(checkoutId, payerAddress, method) {
  const response = await apiJson(`/api/checkout/${checkoutId}/evm-payment-actions`, {
    method: 'POST',
    body: JSON.stringify({ payerAddress }),
  })
  const action = response.actions?.find((entry) => entry.method === method && !entry.disabledReason)
  assert(action, `checkout ${checkoutId} did not expose enabled ${method} funding action`)
  assert(action.authorization?.typedData, `${method} action did not include typed data`)
  assert(action.authorization?.settlementArgs, `${method} action did not include settlement args`)
  return action
}

async function ensureTokenApproval({ amount, owner, publicClient, spender, token, walletClient }) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })
  if (allowance >= amount) {
    return null
  }

  const approveHash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  return approveHash
}

function permit2PaymentArgs(action) {
  const permit2 = action.authorization?.settlementArgs?.permit2
  const permitted = permit2?.permit?.permitted
  assert(permit2?.permit2, 'Permit2 settlement args missing permit2 contract')
  assert(permit2?.payer, 'Permit2 settlement args missing payer')
  assert(permitted?.token, 'Permit2 settlement args missing permitted token')
  assert(permitted?.amount, 'Permit2 settlement args missing permitted amount')
  assert(permit2?.permit?.nonce, 'Permit2 settlement args missing nonce')
  assert(permit2?.permit?.deadline, 'Permit2 settlement args missing deadline')
  assert(permit2?.witness, 'Permit2 settlement args missing witness')
  assert(permit2?.witnessTypeString, 'Permit2 settlement args missing witness type')

  return {
    permit2: getAddress(permit2.permit2),
    payer: getAddress(permit2.payer),
    permit: {
      permitted: {
        token: getAddress(permitted.token),
        amount: BigInt(permitted.amount),
      },
      nonce: BigInt(permit2.permit.nonce),
      deadline: BigInt(permit2.permit.deadline),
    },
    witness: permit2.witness,
    witnessTypeString: permit2.witnessTypeString,
  }
}

function normalizeTypedData(raw) {
  return {
    domain: normalizeTypedValue(raw.domain),
    message: normalizeTypedValue(raw.message),
    primaryType: raw.primaryType,
    types: raw.types,
  }
}

function normalizeTypedValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeTypedValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeTypedValue(entry)]))
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }
  return value
}

async function signEip3009Authorization({ buyer, intent, params, publicClient, settlement, token }) {
  const deadline = BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000))
  const nonce = await publicClient.readContract({
    address: settlement,
    abi: settlementAbi,
    functionName: 'paymentAuthorizationHash',
    args: [params, buyer.address, deadline],
  })
  const tokenName = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'name' })
  const signature = await buyer.signTypedData({
    domain: {
      chainId: hardhatLocal.id,
      name: tokenName,
      verifyingContract: token,
      version: '1',
    },
    primaryType: 'ReceiveWithAuthorization',
    types: {
      ReceiveWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    message: {
      from: buyer.address,
      to: settlement,
      value: params.grossAmount,
      validAfter: 0n,
      validBefore: deadline,
      nonce,
    },
  })
  const split = hexToSignature(signature)

  return {
    authorization: {
      nonce,
      payer: buyer.address,
      r: split.r,
      s: split.s,
      v: Number(split.v),
      validAfter: 0n,
      validBefore: deadline,
    },
    signature,
  }
}

function settlementPaymentParams(intent, token) {
  return {
    intentId: intent.settlementIntentId,
    projectId: intent.settlementProjectId,
    token,
    grossAmount: BigInt(intent.expectedAmountMinorUnits),
    merchantNetAmount: BigInt(intent.merchantNetMinorUnits),
    platformFeeAmount: BigInt(intent.platformFeeMinorUnits),
    expiresAt: BigInt(Math.floor(new Date(intent.expiresAt).getTime() / 1000)),
  }
}

async function settlementBalanceSnapshot(publicClient, settlement, token, intent) {
  return {
    merchant: await publicClient.readContract({
      address: settlement,
      abi: settlementAbi,
      functionName: 'merchantBalanceOf',
      args: [intent.settlementProjectId, token],
    }),
    platform: await publicClient.readContract({
      address: settlement,
      abi: settlementAbi,
      functionName: 'platformBalanceOf',
      args: [token],
    }),
    settlementToken: await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [settlement],
    }),
  }
}

async function assertOnchainSettlementBalances(publicClient, settlement, token, intent, before) {
  const after = await settlementBalanceSnapshot(publicClient, settlement, token, intent)
  assert(after.merchant === BigInt(intent.merchantNetMinorUnits), 'merchantBalanceOf did not equal merchant net')
  assert(
    after.platform - before.platform === BigInt(intent.platformFeeMinorUnits),
    'platformBalanceOf did not increase by platform fee',
  )
  assert(
    after.settlementToken - before.settlementToken === BigInt(intent.expectedAmountMinorUnits),
    'settlement token balance did not increase by gross amount',
  )
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

async function submitWithdrawProof(setup, payment, overview) {
  const intent = setup.checkout.evmPaymentIntent
  const balance = overview.evmAssetBalances.find(
    (entry) =>
      entry.chainId === intent.chainId &&
      entry.tokenContract.toLowerCase() === intent.tokenContract.toLowerCase(),
  )
  assert(balance?.withdrawableMinorUnits >= intent.merchantNetMinorUnits, 'withdrawable balance is lower than merchant net')
  const withdraw = await fetch(`${WEB_BASE_URL}/api/dev/local-evm-withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      amountMinorUnits: intent.merchantNetMinorUnits,
      chainId: intent.chainId,
      recipientAddress: payment.buyer,
      settlementContract: payment.settlement,
      settlementProjectId: intent.settlementProjectId,
      tokenContract: payment.token,
    }),
  })
  const body = await withdraw.text()
  if (!withdraw.ok) {
    throw new Error(`/api/dev/local-evm-withdraw failed with ${withdraw.status}: ${body}`)
  }
  const withdrawReceipt = JSON.parse(body)
  const projected = await apiJson(`/api/projects/${setup.projectId}/withdrawals`, {
    method: 'POST',
    headers: { cookie: setup.merchant.cookie },
    body: JSON.stringify({
      amountMinorUnits: intent.merchantNetMinorUnits,
      chainId: intent.chainId,
      chainTxHash: withdrawReceipt.chainTxHash,
      recipientAddress: payment.buyer,
      settlementContract: payment.settlement,
      tokenContract: payment.token,
    }),
  })
  const updatedBalance = projected.evmAssetBalances.find(
    (entry) =>
      entry.chainId === intent.chainId &&
      entry.tokenContract.toLowerCase() === intent.tokenContract.toLowerCase(),
  )
  assert(updatedBalance?.withdrawableMinorUnits === 0, 'withdraw proof did not reduce withdrawable balance to zero')
  return withdrawReceipt
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

  const methods = FUNDING_METHOD === 'all' ? ['approve-pay', 'eip3009', 'permit2', 'erc2612'] : [FUNDING_METHOD]
  const results = []

  for (const [index, method] of methods.entries()) {
    const setup = CHECKOUT_ID && index === 0 ? await loadCheckout(CHECKOUT_ID) : await createCheckout()
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
      results.push({ mode: 'prepare-only', fundingMethod: method, ...prepared })
      continue
    }

    const payment = await payCheckout(setup.checkout, method)
    const indexer = await runIndexerOnce()
    const publicCheckout = await pollPaid(setup.checkout.checkoutSessionId)
    const overview = await loadOverview(setup.projectId, setup.merchant.cookie)
    const balance = overview.evmAssetBalances.find(
      (entry) =>
        entry.chainId === setup.checkout.evmPaymentIntent.chainId &&
        entry.tokenContract.toLowerCase() === setup.checkout.evmPaymentIntent.tokenContract.toLowerCase(),
    )
    const ledger = overview.evmSettlementLedger.find(
      (entry) => entry.txHash.toLowerCase() === payment.paymentHash.toLowerCase(),
    )

    assert(ledger?.status === 'confirmed', `expected confirmed settlement ledger entry, got ${ledger?.status}`)
    assert(balance?.confirmedMinorUnits >= setup.checkout.evmPaymentIntent.expectedAmountMinorUnits, 'confirmed EVM balance did not include settlement')
    const withdraw = WITHDRAW_PROOF ? await submitWithdrawProof(setup, payment, overview) : null

    results.push({
      ...prepared,
      buyer: payment.buyer,
      finalityStatus: publicCheckout.invoice.snapshot.finalityStatus,
      fundingMethod: method,
      indexer,
      ledgerStatus: ledger.status,
      paymentTruth: publicCheckout.invoice.snapshot.paymentTruth,
      paymentBlock: payment.paymentBlock,
      paymentHash: payment.paymentHash,
      relayerAddress: payment.relayerAddress,
      withdrawHash: withdraw?.chainTxHash ?? null,
    })
  }

  console.log(JSON.stringify({ ok: true, fundingMethod: FUNDING_METHOD, results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
