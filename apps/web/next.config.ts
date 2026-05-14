import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { NextConfig } from 'next'

const appDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(appDir, '../..')
const publicDocsContent = '../../docs/content/public/**/*.md'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  outputFileTracingIncludes: {
    '/*': [publicDocsContent],
    '/docs': [publicDocsContent],
    '/docs/[slug]': [publicDocsContent],
  },
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  serverExternalPackages: ['hardhat', '@fhevm/mock-utils'],
}

export default nextConfig
