import type { Chain } from 'viem'
import { localDevAddresses, localHardhat, sepolia, sepoliaAddresses, type AddressManifest } from './contracts.ts'
import {
  contractEnvironmentFromRuntimeProfile,
  runtimeProfileForContractEnvironment,
  type ContractEnvironment,
  type ProjectEnvironmentValue,
} from './runtime-profile.ts'
import { localHardhatWalletChain, sepoliaWalletChain, type WalletChain } from './wallet.ts'

export type { ContractEnvironment, ProjectEnvironmentValue } from './runtime-profile.ts'

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

const localRuntimeProfile = runtimeProfileForContractEnvironment('local-dev')
const sepoliaRuntimeProfile = runtimeProfileForContractEnvironment('sepolia')

export const contractEnvironmentConfigs: Record<ContractEnvironment, ContractEnvironmentConfig> = {
  'local-dev': {
    key: 'local-dev',
    label: localRuntimeProfile.label,
    projectEnvironment: localRuntimeProfile.projectEnvironment,
    manifestRoute: 'local-dev',
    chain: localHardhat,
    walletChain: localHardhatWalletChain,
    manifest: localDevAddresses,
  },
  sepolia: {
    key: 'sepolia',
    label: sepoliaRuntimeProfile.label,
    projectEnvironment: sepoliaRuntimeProfile.projectEnvironment,
    manifestRoute: 'sepolia',
    chain: sepolia,
    walletChain: sepoliaWalletChain,
    manifest: sepoliaAddresses,
  },
}

export const projectEnvironmentOptions = [
  ...Object.values(contractEnvironmentConfigs).map((config) => ({
    label: config.label,
    value: config.projectEnvironment,
  })),
] as const

export function normalizeContractEnvironment(value: string | null | undefined): ContractEnvironment {
  if (!value?.trim()) {
    return defaultContractEnvironment
  }

  const normalized = value.trim().toLowerCase().replaceAll('_', '-')
  if (normalized === 'local-dev') {
    return 'local-dev'
  }
  if (normalized === 'sepolia') {
    return 'sepolia'
  }

  throw new Error(`Unsupported contract environment "${value}". Use "local-dev" or "sepolia".`)
}

export function publicContractEnvironment(): ContractEnvironment {
  return contractEnvironmentFromRuntimeProfile(process.env.NEXT_PUBLIC_RUNTIME_PROFILE)
}

export function serverContractEnvironment(): ContractEnvironment {
  return contractEnvironmentFromRuntimeProfile(process.env.ZAMAPAY_RUNTIME_PROFILE ?? process.env.NEXT_PUBLIC_RUNTIME_PROFILE)
}

export function contractEnvironmentConfig(environment: string | null | undefined): ContractEnvironmentConfig {
  return contractEnvironmentConfigs[normalizeContractEnvironment(environment)]
}

export function contractEnvironmentForChainId(chainId: number | null | undefined): ContractEnvironment | null {
  return Object.values(contractEnvironmentConfigs).find((config) => config.chain.id === chainId)?.key ?? null
}

export function labelForProjectEnvironment(value: ProjectEnvironmentValue | null | undefined): string {
  if (!value) {
    return 'No environment'
  }

  return contractEnvironmentConfigs[normalizeContractEnvironment(value)].label
}
