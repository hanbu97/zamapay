import type { Chain } from 'viem'
import { sepolia } from 'viem/chains'
import { localDevAddresses, localHardhat, sepoliaAddresses, type AddressManifest } from './contracts.ts'
import { localHardhatWalletChain, sepoliaWalletChain, type WalletChain } from './wallet.ts'

export type ContractEnvironment = 'local-dev' | 'sepolia'
export type ProjectEnvironmentValue = 'local_dev' | 'sepolia'

export type ContractEnvironmentConfig = {
  key: ContractEnvironment
  label: string
  projectEnvironment: ProjectEnvironmentValue
  manifestRoute: ContractEnvironment
  chain: Chain
  walletChain: WalletChain
  manifest: AddressManifest | null
  browserRelayer: boolean
}

export const defaultContractEnvironment: ContractEnvironment = 'local-dev'

export const contractEnvironmentConfigs: Record<ContractEnvironment, ContractEnvironmentConfig> = {
  'local-dev': {
    key: 'local-dev',
    label: 'Local dev',
    projectEnvironment: 'local_dev',
    manifestRoute: 'local-dev',
    chain: localHardhat,
    walletChain: localHardhatWalletChain,
    manifest: localDevAddresses,
    browserRelayer: false,
  },
  sepolia: {
    key: 'sepolia',
    label: 'Zama Sepolia',
    projectEnvironment: 'sepolia',
    manifestRoute: 'sepolia',
    chain: sepolia,
    walletChain: sepoliaWalletChain,
    manifest: sepoliaAddresses,
    browserRelayer: true,
  },
}

export const projectEnvironmentOptions = [
  {
    label: contractEnvironmentConfigs['local-dev'].label,
    value: contractEnvironmentConfigs['local-dev'].projectEnvironment,
  },
  {
    label: contractEnvironmentConfigs.sepolia.label,
    value: contractEnvironmentConfigs.sepolia.projectEnvironment,
  },
] as const

export const sepoliaContractEnvironment = contractEnvironmentConfigs.sepolia

export function normalizeContractEnvironment(value: string | null | undefined): ContractEnvironment {
  if (!value?.trim()) {
    return defaultContractEnvironment
  }

  const normalized = value.trim().toLowerCase().replaceAll('_', '-')
  switch (normalized) {
    case 'dev':
    case 'development':
    case 'hardhat':
    case 'local':
    case 'localhost':
    case 'local-dev':
      return 'local-dev'
    case 'sepolia':
    case 'test':
    case 'testnet':
    case 'zama-sepolia':
      return 'sepolia'
    default:
      throw new Error(`Unsupported contract environment "${value}". Use "local-dev" or "sepolia".`)
  }
}

export function publicContractEnvironment(): ContractEnvironment {
  return normalizeContractEnvironment(process.env.NEXT_PUBLIC_CONTRACT_ENV)
}

export function serverContractEnvironment(): ContractEnvironment {
  return normalizeContractEnvironment(process.env.MERMER_CONTRACT_ENV ?? process.env.NEXT_PUBLIC_CONTRACT_ENV)
}

export function contractEnvironmentConfig(environment: string | null | undefined): ContractEnvironmentConfig {
  return contractEnvironmentConfigs[normalizeContractEnvironment(environment)]
}

export function contractEnvironmentForChainId(chainId: number | null | undefined): ContractEnvironment | null {
  if (chainId === contractEnvironmentConfigs['local-dev'].chain.id) {
    return 'local-dev'
  }
  if (chainId === contractEnvironmentConfigs.sepolia.chain.id) {
    return 'sepolia'
  }

  return null
}

export function labelForProjectEnvironment(value: ProjectEnvironmentValue | null | undefined): string {
  if (!value) {
    return 'No environment'
  }

  return value === 'sepolia' ? contractEnvironmentConfigs.sepolia.label : contractEnvironmentConfigs['local-dev'].label
}
