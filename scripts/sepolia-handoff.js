const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const MANIFEST_PATH = path.join(ROOT, 'generated', 'contracts', 'addresses', 'sepolia.json')
const DEFAULT_AMOUNT = '1000000000'

const PREDEPLOY_CHECKS = [
  'Hardhat network is Sepolia',
  'Sepolia RPC reachable',
  'DEPLOYER_PRIVATE_KEY configured',
  'DEPLOYER_PRIVATE_KEY is valid 32-byte hex',
  'deployer signer available',
  'deployer is not a public Hardhat test key',
  'deployer has Sepolia ETH',
  'NEXT_PUBLIC_CONTRACT_ENV selects Sepolia',
  'MERMER_OPERATOR_KEY configured',
  'MERMER_OPERATOR_KEY is not the local default',
  'MERMER_WEBHOOK_SECRET configured',
  'MERMER_WEBHOOK_SECRET is not the local default',
  'MERMER_GATEWAY_CALLBACK_KEY configured',
  'MERMER_GATEWAY_CALLBACK_KEY is not the local default',
  'BUYER_ADDRESS configured',
  'BUYER_ADDRESS is valid',
  'BUYER_ADDRESS is not a public Hardhat test address',
  'buyer has Sepolia ETH',
  'AMOUNT_MINOR_UNITS is valid uint64 text',
  'AMOUNT_MINOR_UNITS fits test token uint64',
]

function runCapture(label, args) {
  const result = spawnSync('npm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  })

  if (!result.stdout.includes('{')) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`${label} did not produce a JSON readiness report.`)
  }

  return result
}

function runStep(label, args, env = process.env) {
  console.log(`\n==> ${label}`)
  const result = spawnSync('npm', args, {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed.`)
  }
}

function parseReport(stdout) {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Could not find JSON in verify:sepolia output.')
  }

  return JSON.parse(stdout.slice(start, end + 1))
}

function requiredFailures(report) {
  const checks = new Map(report.checks.map((check) => [check.name, check]))

  return PREDEPLOY_CHECKS.flatMap((name) => {
    const check = checks.get(name)

    if (!check) {
      return [`${name}: missing`]
    }

    return check.ok ? [] : [`${name}: ${check.detail}`]
  })
}

function assertPredeployReady() {
  console.log('==> Sepolia preflight')
  const result = runCapture('Sepolia preflight', ['run', 'verify:sepolia'])
  const report = parseReport(result.stdout)
  const failures = requiredFailures(report)

  if (failures.length > 0) {
    throw new Error(`Sepolia funding/environment is not ready:\n- ${failures.join('\n- ')}`)
  }

  console.log(`ok Sepolia preflight at ${report.checks.find((check) => check.name === 'Sepolia RPC reachable')?.detail}`)
}

function shouldDeploy() {
  return process.env.MERMER_FORCE_SEPOLIA_DEPLOY === '1' || !fs.existsSync(MANIFEST_PATH)
}

function main() {
  assertPredeployReady()

  if (shouldDeploy()) {
    runStep('Deploy Sepolia contracts', ['run', 'deploy:sepolia'])
  } else {
    console.log(`\n==> Reuse Sepolia manifest\n${MANIFEST_PATH}`)
  }

  const env = { ...process.env, AMOUNT_MINOR_UNITS: process.env.AMOUNT_MINOR_UNITS ?? DEFAULT_AMOUNT }
  runStep('Mint confidential test USD', ['run', 'mint:test-usd:sepolia'], env)
  runStep('Verify Sepolia payment rail', ['run', 'verify:sepolia'], env)

  console.log(
    JSON.stringify(
      {
        ok: true,
        manifestPath: MANIFEST_PATH,
        amountMinorUnits: env.AMOUNT_MINOR_UNITS,
        forceDeploy: process.env.MERMER_FORCE_SEPOLIA_DEPLOY === '1',
      },
      null,
      2,
    ),
  )
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
