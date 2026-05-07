const fs = require('fs')
const path = require('path')
const hre = require('hardhat')
const { isPublicHardhatAddress } = require('./public-hardhat-keys')

const API_BASE_URL = process.env.MERMER_API_BASE_URL ?? 'http://127.0.0.1:8080'
const EXPECTED_CHAIN_ID = 11155111n
const CONTRACT_NAMES = ['MerchantRegistry', 'ConfidentialUSDMock', 'ConfidentialInvoiceSettlement']
const DEFAULT_OPERATOR_KEY = 'local-operator-dev-key'
const DEFAULT_WEBHOOK_SECRET = 'local-webhook-dev-secret'
const DEFAULT_GATEWAY_CALLBACK_KEY = 'local-zama-gateway-dev-key'
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/

function manifestPath() {
  return path.resolve(__dirname, '..', '..', 'generated', 'contracts', 'addresses', 'sepolia.json')
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok, detail })
}

function parseAmountMinorUnits(checks) {
  const value = process.env.AMOUNT_MINOR_UNITS ?? '1000000000'
  const valid = /^\d+$/.test(value)
  addCheck(checks, 'AMOUNT_MINOR_UNITS is valid uint64 text', valid, value)

  if (!valid) {
    return null
  }

  const amount = BigInt(value)
  const inRange = amount > 0n && amount <= 18_446_744_073_709_551_615n
  addCheck(checks, 'AMOUNT_MINOR_UNITS fits demo token uint64', inRange, value)

  return inRange ? amount : null
}

function readManifest(checks) {
  const file = manifestPath()

  if (!fs.existsSync(file)) {
    addCheck(checks, 'sepolia manifest exists', false, `${file} is missing. Run npm --workspace contracts run deploy:sepolia.`)
    return null
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    addCheck(checks, 'sepolia manifest parses', true, file)
    return manifest
  } catch (error) {
    addCheck(checks, 'sepolia manifest parses', false, error.message)
    return null
  }
}

function compareContracts(localManifest, apiManifest) {
  const mismatches = []

  for (const name of CONTRACT_NAMES) {
    const localAddress = localManifest.contracts?.[name]
    const apiAddress = apiManifest.contracts?.[name]

    if (localAddress?.toLowerCase() !== apiAddress?.toLowerCase()) {
      mismatches.push(`${name}: generated=${localAddress ?? 'missing'} api=${apiAddress ?? 'missing'}`)
    }
  }

  return mismatches
}

async function checkApiManifest(checks, manifest) {
  if (!manifest) {
    addCheck(checks, 'Rust API serves Sepolia manifest', false, 'Skipped because generated Sepolia manifest is missing.')
    return
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/contracts/sepolia`)
    const text = await response.text()

    if (!response.ok) {
      addCheck(checks, 'Rust API serves Sepolia manifest', false, `${response.status}: ${text}`)
      return
    }

    const apiManifest = JSON.parse(text)
    const mismatches = compareContracts(manifest, apiManifest)

    addCheck(
      checks,
      'Rust API serves Sepolia manifest',
      mismatches.length === 0,
      mismatches.length === 0 ? `${API_BASE_URL}/api/contracts/sepolia` : mismatches.join('; '),
    )
  } catch (error) {
    addCheck(checks, 'Rust API serves Sepolia manifest', false, `${API_BASE_URL}: ${error.message}`)
  }
}

async function checkManifestContracts(checks, manifest) {
  if (!manifest) {
    return
  }

  addCheck(checks, 'manifest chainId is Sepolia', BigInt(manifest.chainId ?? 0) === EXPECTED_CHAIN_ID, manifest.chainId)

  for (const name of CONTRACT_NAMES) {
    const address = manifest.contracts?.[name]
    const hasAddress = typeof address === 'string' && address.startsWith('0x')
    addCheck(checks, `${name} address exists`, hasAddress, address ?? 'missing')

    if (!hasAddress) {
      continue
    }

    const code = await hre.ethers.provider.getCode(address)
    addCheck(checks, `${name} bytecode exists`, code !== '0x', address)
  }
}

async function checkNetwork(checks) {
  const network = await hre.ethers.provider.getNetwork()
  const blockNumber = await hre.ethers.provider.getBlockNumber()

  addCheck(checks, 'Hardhat network is Sepolia', network.chainId === EXPECTED_CHAIN_ID, String(network.chainId))
  addCheck(checks, 'Sepolia RPC reachable', blockNumber >= 0, `block ${blockNumber}`)
}

function checkBrowserEnvironment(checks) {
  const env = process.env.NEXT_PUBLIC_CONTRACT_ENV
  addCheck(
    checks,
    'NEXT_PUBLIC_CONTRACT_ENV selects Sepolia',
    env === 'sepolia',
    env ? `${env}` : 'missing; start web with NEXT_PUBLIC_CONTRACT_ENV=sepolia',
  )
}

function checkOperatorKey(checks) {
  const configured = process.env.MERMER_OPERATOR_KEY
  addCheck(checks, 'MERMER_OPERATOR_KEY configured', Boolean(configured), configured ? 'configured' : 'missing')

  if (!configured) {
    return
  }

  addCheck(
    checks,
    'MERMER_OPERATOR_KEY is not the local default',
    configured !== DEFAULT_OPERATOR_KEY,
    configured === DEFAULT_OPERATOR_KEY ? 'local default is unsafe for Sepolia' : 'non-default',
  )
}

function checkWebhookSecret(checks) {
  const configured = process.env.MERMER_WEBHOOK_SECRET
  addCheck(checks, 'MERMER_WEBHOOK_SECRET configured', Boolean(configured), configured ? 'configured' : 'missing')

  if (!configured) {
    return
  }

  addCheck(
    checks,
    'MERMER_WEBHOOK_SECRET is not the local default',
    configured !== DEFAULT_WEBHOOK_SECRET,
    configured === DEFAULT_WEBHOOK_SECRET ? 'local default is unsafe for Sepolia' : 'non-default',
  )
}

function checkGatewayCallbackKey(checks) {
  const configured = process.env.MERMER_GATEWAY_CALLBACK_KEY
  addCheck(checks, 'MERMER_GATEWAY_CALLBACK_KEY configured', Boolean(configured), configured ? 'configured' : 'missing')

  if (!configured) {
    return
  }

  addCheck(
    checks,
    'MERMER_GATEWAY_CALLBACK_KEY is not the local default',
    configured !== DEFAULT_GATEWAY_CALLBACK_KEY,
    configured === DEFAULT_GATEWAY_CALLBACK_KEY ? 'local default is unsafe for Sepolia' : 'non-default',
  )
}

async function checkBuyer(checks) {
  const configured = process.env.BUYER_ADDRESS
  addCheck(checks, 'BUYER_ADDRESS configured', Boolean(configured), configured ? 'configured' : 'missing')

  if (!configured) {
    return null
  }

  let buyerAddress
  try {
    buyerAddress = hre.ethers.getAddress(configured)
    addCheck(checks, 'BUYER_ADDRESS is valid', true, buyerAddress)
  } catch (error) {
    addCheck(checks, 'BUYER_ADDRESS is valid', false, error.message)
    return null
  }

  const safeBuyer = !isPublicHardhatAddress(buyerAddress)
  addCheck(
    checks,
    'BUYER_ADDRESS is not a public Hardhat test address',
    safeBuyer,
    safeBuyer ? buyerAddress : `${buyerAddress} is a public Hardhat test address`,
  )

  if (safeBuyer) {
    const balance = await hre.ethers.provider.getBalance(buyerAddress)
    addCheck(checks, 'buyer has Sepolia ETH', balance > 0n, `${hre.ethers.formatEther(balance)} ETH`)
  } else {
    addCheck(checks, 'buyer has Sepolia ETH', false, 'Skipped because buyer address is unsafe.')
  }

  return safeBuyer ? buyerAddress : null
}

async function checkDeployer(checks) {
  const configured = process.env.DEPLOYER_PRIVATE_KEY
  const hasPrivateKey = Boolean(configured)
  addCheck(checks, 'DEPLOYER_PRIVATE_KEY configured', hasPrivateKey, hasPrivateKey ? 'configured' : 'missing')

  if (configured) {
    addCheck(
      checks,
      'DEPLOYER_PRIVATE_KEY is valid 32-byte hex',
      PRIVATE_KEY_PATTERN.test(configured),
      PRIVATE_KEY_PATTERN.test(configured) ? 'valid format' : 'must be 0x followed by 64 hex characters',
    )
  }

  const [deployer] = await hre.ethers.getSigners()

  if (!deployer) {
    addCheck(checks, 'deployer signer available', false, 'No signer configured for the Sepolia network.')
    addCheck(checks, 'deployer has Sepolia ETH', false, 'Skipped because deployer signer is missing.')
    return
  }

  const address = await deployer.getAddress()
  const safeDeployer = !isPublicHardhatAddress(address)
  const balance = await hre.ethers.provider.getBalance(address)

  addCheck(checks, 'deployer signer available', true, address)
  addCheck(
    checks,
    'deployer is not a public Hardhat test key',
    safeDeployer,
    safeDeployer ? address : `${address} is a public Hardhat test address`,
  )
  addCheck(checks, 'deployer has Sepolia ETH', balance > 0n, `${hre.ethers.formatEther(balance)} ETH`)
}

async function main() {
  const checks = []

  await checkNetwork(checks)
  await checkDeployer(checks)
  checkBrowserEnvironment(checks)
  checkOperatorKey(checks)
  checkWebhookSecret(checks)
  checkGatewayCallbackKey(checks)
  await checkBuyer(checks)
  parseAmountMinorUnits(checks)

  const manifest = readManifest(checks)
  await checkManifestContracts(checks, manifest)
  await checkApiManifest(checks, manifest)

  const ok = checks.every((check) => check.ok)
  console.log(
    JSON.stringify(
      {
        ok,
        network: hre.network.name,
        apiBaseUrl: API_BASE_URL,
        manifestPath: manifestPath(),
        checks,
      },
      null,
      2,
    ),
  )

  if (!ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
