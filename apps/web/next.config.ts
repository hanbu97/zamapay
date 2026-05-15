import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(appDir, '../..')
const publicDocsContent = '../../docs/content/public/**/*.md'
const zamapaySkill = '../../skills/zamapay/SKILL.md'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  outputFileTracingIncludes: {
    '/*': [publicDocsContent, zamapaySkill],
    '/.well-known/skills/zamapay': [zamapaySkill],
    '/docs': [publicDocsContent],
    '/docs/[slug]': [publicDocsContent],
    '/docs/[slug]/markdown': [publicDocsContent],
    '/docs/manifest.json': [publicDocsContent],
    '/llms-full.txt': [publicDocsContent],
    '/llms.txt': [publicDocsContent],
  },
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/docs/:slug.md',
        destination: '/docs/:slug/markdown',
      },
    ]
  },
  serverExternalPackages: ['hardhat', '@fhevm/mock-utils'],
}

export default nextConfig
