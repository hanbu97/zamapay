import { createPublicClient, getAddress, http, parseAbiItem, webSocket } from 'viem'

const API_BASE_URL = cleanBaseUrl(process.env.ZAMAPAY_API_URL ?? 'http://127.0.0.1:18080')
const OPERATOR_KEY = process.env.ZAMAPAY_OPERATOR_KEY ?? 'local-operator-dev-key'
const FROM_BLOCKS = Number.parseInt(process.env.ZAMAPAY_EVM_INDEXER_FROM_BLOCKS ?? '200', 10)
const REORG_WINDOW_BLOCKS = Number.parseInt(process.env.ZAMAPAY_EVM_INDEXER_REORG_WINDOW_BLOCKS ?? '12', 10)
const POLL_MS = Number.parseInt(process.env.ZAMAPAY_EVM_INDEXER_POLL_MS ?? '5000', 10)
const ONCE = process.argv.includes('--once')
const PAYMENT_ACCEPTED_EVENT = parseAbiItem(
  'event EvmPaymentAccepted(bytes32 indexed intentId, bytes32 indexed projectId, address indexed payer, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount)',
)

function cleanBaseUrl(value) {
  return value.trim().replace(/\/+$/, '')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function apiJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-operator-key': OPERATOR_KEY,
      ...(options.headers ?? {}),
    },
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${body}`)
  }

  return body ? JSON.parse(body) : null
}

function publicClientFor(asset) {
  const transport = asset.rpcUrl.startsWith('ws') ? webSocket(asset.rpcUrl) : http(asset.rpcUrl)
  return createPublicClient({ transport })
}

function toSafeNumber(value, label) {
  const bigint = BigInt(value)
  assert(bigint <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds JavaScript safe integer range`)
  return Number(bigint)
}

async function projectSettlementEvent(asset, log, latestBlock) {
  const grossAmount = log.args?.grossAmount
  const merchantNetAmount = log.args?.merchantNetAmount
  const platformFeeAmount = log.args?.platformFeeAmount
  assert(grossAmount !== undefined, 'EvmPaymentAccepted log is missing grossAmount')
  assert(merchantNetAmount !== undefined, 'EvmPaymentAccepted log is missing merchantNetAmount')
  assert(platformFeeAmount !== undefined, 'EvmPaymentAccepted log is missing platformFeeAmount')

  return apiJson('/api/operator/evm/settlement-events', {
    method: 'POST',
    body: JSON.stringify({
      settlementIntentId: log.args.intentId,
      settlementProjectId: log.args.projectId,
      settlementContract: asset.settlementContract,
      chainId: asset.chainId,
      tokenContract: getAddress(log.args.token),
      txHash: log.transactionHash,
      logIndex: Number(log.logIndex ?? 0),
      blockNumber: toSafeNumber(log.blockNumber ?? 0n, 'blockNumber'),
      blockHash: log.blockHash ?? null,
      fromAddress: log.args.payer,
      toAddress: asset.settlementContract,
      amountMinorUnits: toSafeNumber(grossAmount, 'amountMinorUnits'),
      merchantNetMinorUnits: toSafeNumber(merchantNetAmount, 'merchantNetMinorUnits'),
      platformFeeMinorUnits: toSafeNumber(platformFeeAmount, 'platformFeeMinorUnits'),
      confirmations: toSafeNumber(latestBlock - (log.blockNumber ?? latestBlock) + 1n, 'confirmations'),
    }),
  })
}

async function projectCursor(asset, lastScannedBlock, lastFinalizedBlock) {
  return apiJson('/api/operator/evm/cursors', {
    method: 'POST',
    body: JSON.stringify({
      chainId: asset.chainId,
      settlementContract: asset.settlementContract,
      lastScannedBlock: toSafeNumber(lastScannedBlock, 'lastScannedBlock'),
      lastFinalizedBlock: toSafeNumber(lastFinalizedBlock, 'lastFinalizedBlock'),
    }),
  })
}

async function scanAsset(asset) {
  const client = publicClientFor(asset)
  const latestBlock = await client.getBlockNumber()
  const cursorBlock = BigInt(asset.cursor?.lastScannedBlock ?? 0)
  const reorgWindow = BigInt(REORG_WINDOW_BLOCKS)
  const fromBlock = cursorBlock > latestBlock
    ? latestBlock > BigInt(FROM_BLOCKS)
      ? latestBlock - BigInt(FROM_BLOCKS)
      : 0n
    : cursorBlock > reorgWindow
    ? cursorBlock - reorgWindow + 1n
    : latestBlock > BigInt(FROM_BLOCKS)
      ? latestBlock - BigInt(FROM_BLOCKS)
      : 0n
  const logs = await client.getLogs({
    address: asset.settlementContract,
    event: PAYMENT_ACCEPTED_EVENT,
    fromBlock,
    toBlock: latestBlock,
  })

  let projected = 0
  for (const log of logs) {
    if (!asset.openIntentIds.includes(String(log.args.intentId))) {
      continue
    }
    if (getAddress(log.args.token).toLowerCase() !== getAddress(asset.tokenContract).toLowerCase()) {
      continue
    }
    await projectSettlementEvent(asset, log, latestBlock)
    projected += 1
  }

  const finalizedBlock = latestBlock > reorgWindow ? latestBlock - reorgWindow : 0n
  await projectCursor(asset, latestBlock, finalizedBlock)

  return projected
}

async function runOnce() {
  const watchlist = await apiJson('/api/operator/evm/watchlist')
  const assets = watchlist.assets.filter((asset) => asset.openIntentIds.length > 0)
  let projected = 0

  for (const asset of assets) {
    projected += await scanAsset(asset)
  }

  console.log(
    JSON.stringify({
      assets: assets.length,
      projected,
      scannedAt: new Date().toISOString(),
    }),
  )
}

async function main() {
  assert(Number.isSafeInteger(FROM_BLOCKS) && FROM_BLOCKS > 0, 'ZAMAPAY_EVM_INDEXER_FROM_BLOCKS must be positive')
  assert(Number.isSafeInteger(REORG_WINDOW_BLOCKS) && REORG_WINDOW_BLOCKS >= 0, 'ZAMAPAY_EVM_INDEXER_REORG_WINDOW_BLOCKS must be non-negative')
  assert(Number.isSafeInteger(POLL_MS) && POLL_MS >= 1000, 'ZAMAPAY_EVM_INDEXER_POLL_MS must be at least 1000')

  do {
    await runOnce()
    if (ONCE) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  } while (true)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
