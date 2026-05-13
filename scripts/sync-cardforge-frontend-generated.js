#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const frontendGeneratedDir = path.join(projectRoot, 'demo', 'cardforge', 'frontend', 'generated')

const copies = [
  {
    from: path.join(projectRoot, 'generated', 'clients', 'ts', 'contracts.ts'),
    to: path.join(frontendGeneratedDir, 'contracts.ts'),
  },
  {
    from: path.join(projectRoot, 'env', 'runtime-profiles.json'),
    to: path.join(frontendGeneratedDir, 'runtime-profiles.json'),
  },
]

fs.mkdirSync(frontendGeneratedDir, { recursive: true })

for (const copy of copies) {
  fs.copyFileSync(copy.from, copy.to)
  console.log(`synced ${path.relative(projectRoot, copy.to)}`)
}
