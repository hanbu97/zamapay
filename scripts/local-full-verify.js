const { spawnSync } = require('child_process')

const node = process.execPath

const checks = [
  ['runtime profile config', [node, ['scripts/verify-runtime-profile.js', 'local-dev']]],
  ['web unit tests', ['npm', ['run', 'test:web']]],
  ['web e2e tests', ['npm', ['--workspace', 'apps/web', 'run', 'test:e2e']]],
  ['web typecheck', ['npm', ['run', 'lint:web']]],
  ['web production build', ['npm', ['run', 'build:web']]],
  ['rust format', ['cargo', ['fmt', '--all', '--check']]],
  ['rust workspace tests', ['cargo', ['test', '--workspace']]],
  ['contract tests', ['npm', ['run', 'test:contracts']]],
  ['local end-to-end readiness', [node, ['scripts/local-readiness.js']]],
]

function runCheck([name, [command, args]]) {
  const startedAt = Date.now()
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  })
  const durationMs = Date.now() - startedAt

  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`${name} failed after ${durationMs}ms`)
  }

  return { name, ok: true, durationMs }
}

function main() {
  const results = []

  for (const check of checks) {
    const result = runCheck(check)
    results.push(result)
    console.log(`ok ${result.name} ${result.durationMs}ms`)
  }

  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
