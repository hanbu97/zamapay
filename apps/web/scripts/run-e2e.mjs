#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const E2E_DIR = path.join(ROOT, 'e2e')
const DEFAULT_SPECS = ['auth-login.spec.ts', 'checkout-flow.spec.ts', 'operator-failure-drills.spec.ts']

function resolveSpec(rawSpec) {
  const candidate = path.isAbsolute(rawSpec)
    ? rawSpec
    : rawSpec.startsWith('e2e/')
      ? path.join(ROOT, rawSpec)
      : path.join(E2E_DIR, rawSpec)
  const resolved = path.resolve(candidate)

  if (!resolved.startsWith(`${E2E_DIR}${path.sep}`)) {
    throw new Error(`E2E spec must live under apps/web/e2e: ${rawSpec}`)
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`E2E spec not found: ${rawSpec}`)
  }

  return resolved
}

const requested = process.argv.slice(2)
const specs = (requested.length > 0 ? requested : DEFAULT_SPECS).map(resolveSpec)
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...specs], {
  cwd: ROOT,
  env: process.env,
  stdio: 'inherit',
})

process.exitCode = result.status ?? 1
