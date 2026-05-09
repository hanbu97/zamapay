import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  reactStrictMode: true,
  serverExternalPackages: ['hardhat', '@fhevm/mock-utils'],
}

export default nextConfig
