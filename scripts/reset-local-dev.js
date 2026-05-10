#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process')
const http = require('node:http')

const POSTGRES_CONTAINER = process.env.ZAMAPAY_POSTGRES_CONTAINER || 'zamapay-postgres'
const POSTGRES_USER = assertSafeIdentifier(process.env.ZAMAPAY_POSTGRES_USER || 'zamapay')
const PLATFORM_DATABASE = process.env.ZAMAPAY_DATABASE_NAME || 'zamapay'
const CARDFORGE_DATABASE = process.env.CARDFORGE_DATABASE_NAME || 'cardforge'
const HARDHAT_RPC_URL = process.env.ZAMAPAY_LOCAL_RPC_URL || 'http://127.0.0.1:8545'

async function main() {
  await assertHardhatLocal()
  run('docker', ['compose', 'up', '-d', 'postgres'])
  await waitForPostgres()
  resetDatabases([PLATFORM_DATABASE, CARDFORGE_DATABASE])
  run('npm', ['--workspace', 'contracts', 'run', 'deploy:localhost'])
  console.log('local-dev reset complete. Restart ZamaPay API and CardForge backend so they recreate fresh schemas.')
}

async function assertHardhatLocal() {
  const chainId = await rpc('eth_chainId', [])
  if (chainId !== '0x7a69') {
    throw new Error(`Expected Hardhat Local chain id 0x7a69 at ${HARDHAT_RPC_URL}, received ${chainId}.`)
  }
  console.log(`local chain ready: ${HARDHAT_RPC_URL} chainId=${chainId}`)
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = execFile('docker', [
      'exec',
      POSTGRES_CONTAINER,
      'pg_isready',
      '-U',
      POSTGRES_USER,
      '-d',
      'postgres',
    ])
    if (result.status === 0) {
      console.log(`postgres ready: ${POSTGRES_CONTAINER}`)
      return
    }
    await delay(1000)
  }

  throw new Error(`Postgres container ${POSTGRES_CONTAINER} did not become ready.`)
}

function resetDatabases(databaseNames) {
  const names = [...new Set(databaseNames.map(assertSafeIdentifier))]
  const quotedNames = names.map((name) => `'${name}'`).join(', ')
  psql(`select pg_terminate_backend(pid) from pg_stat_activity where datname in (${quotedNames}) and pid <> pg_backend_pid()`)

  for (const name of names) {
    psql(`drop database if exists ${quoteIdentifier(name)}`)
    psql(`create database ${quoteIdentifier(name)} owner ${quoteIdentifier(POSTGRES_USER)}`)
    console.log(`database reset: ${name}`)
  }
}

function assertSafeIdentifier(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`)
  }
  return name
}

function quoteIdentifier(name) {
  return `"${assertSafeIdentifier(name)}"`
}

function psql(sql) {
  run('docker', [
    'exec',
    POSTGRES_CONTAINER,
    'psql',
    '-U',
    POSTGRES_USER,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ])
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function execFile(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    const url = new URL(HARDHAT_RPC_URL)
    const request = http.request(
      {
        hostname: url.hostname,
        method: 'POST',
        path: url.pathname || '/',
        port: url.port,
        headers: {
          'content-length': Buffer.byteLength(body),
          'content-type': 'application/json',
        },
        timeout: 3000,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (payload.error) {
              reject(new Error(`${method} failed: ${payload.error.message || JSON.stringify(payload.error)}`))
              return
            }
            resolve(payload.result)
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.on('error', () => reject(new Error(`Hardhat Local is not reachable at ${HARDHAT_RPC_URL}. Start npm --workspace contracts run node first.`)))
    request.on('timeout', () => {
      request.destroy()
      reject(new Error(`Hardhat Local timed out at ${HARDHAT_RPC_URL}.`))
    })
    request.write(body)
    request.end()
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
