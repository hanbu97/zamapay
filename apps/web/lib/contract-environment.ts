import type { Chain } from 'viem'
import { localDevAddresses, localHardhat, type AddressManifest } from './contracts.ts'
import { localHardhatWalletChain, type WalletChain } from './wallet.ts'

export type ContractEnvironment = 'local-dev'
export type ProjectEnvironmentValue = 'local_dev'

export type ContractEnvironmentConfig = {
  key: ContractEnvironment
  label: string
  projectEnvironment: ProjectEnvironmentValue
  manifestRoute: ContractEnvironment
  chain: Chain
  walletChain: WalletChain
  manifest: AddressManifest | null
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
  },
}

export const projectEnvironmentOptions = [
  {
    label: contractEnvironmentConfigs['local-dev'].label,
    value: contractEnvironmentConfigs['local-dev'].projectEnvironment,
  },
] as const

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
    default:
      throw new Error(`Unsupported contract environment "${value}". Use "local-dev".`)
  }
}

export function publicContractEnvironment(): ContractEnvironment {
  return normalizeContractEnvironment(process.env.NEXT_PUBLIC_CONTRACT_ENV)
}

export function serverContractEnvironment(): ContractEnvironment {
  return normalizeContractEnvironment(process.env.ZAMAPAY_CONTRACT_ENV ?? process.env.NEXT_PUBLIC_CONTRACT_ENV)
}

export function contractEnvironmentConfig(environment: string | null | undefined): ContractEnvironmentConfig {
  return contractEnvironmentConfigs[normalizeContractEnvironment(environment)]
}

export function contractEnvironmentForChainId(chainId: number | null | undefined): ContractEnvironment | null {
  return chainId === contractEnvironmentConfigs['local-dev'].chain.id ? 'local-dev' : null
}

export function labelForProjectEnvironment(value: ProjectEnvironmentValue | null | undefined): string {
  return value ? contractEnvironmentConfigs['local-dev'].label : 'No environment'
}
