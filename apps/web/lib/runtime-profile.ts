import runtimeProfileContract from '../../../env/runtime-profiles.json' with { type: 'json' }

export type ContractEnvironment = 'local-dev' | 'sepolia'
export type ProjectEnvironmentValue = 'local_dev' | 'sepolia'
export type RuntimeProfileKey = 'local-dev' | 'sepolia-local-ui' | 'sepolia-preview'

type NativeCurrency = {
  decimals: number
  name: string
  symbol: string
}

export type RuntimeProfile = {
  allowsDevSigner: boolean
  allowsServerInvoiceBridge: boolean
  apiBaseEnv: string[]
  chainId: number
  chainName: string
  checkoutBaseEnv: string[]
  confirmations: number
  contractEnvironment: ContractEnvironment
  defaultApiBaseUrl: string | null
  defaultCheckoutBaseUrl: string | null
  defaultExplorerUrl: string | null
  defaultRpcUrl: string | null
  defaultWebBaseUrl: string | null
  explorerEnv: string[]
  finalityThreshold: number
  key: RuntimeProfileKey
  label: string
  nativeCurrency: NativeCurrency
  projectEnvironment: ProjectEnvironmentValue
  requiresExplicitRpc: boolean
  requiresHttpsPublicUrls: boolean
  rpcEnv: string[]
  webBaseEnv: string[]
}

type UrlEnvField = 'apiBaseEnv' | 'checkoutBaseEnv' | 'explorerEnv' | 'rpcEnv' | 'webBaseEnv'
type UrlFallbackField =
  | 'defaultApiBaseUrl'
  | 'defaultCheckoutBaseUrl'
  | 'defaultExplorerUrl'
  | 'defaultRpcUrl'
  | 'defaultWebBaseUrl'

type RuntimeProfileDocument = {
  defaultProfile: RuntimeProfileKey
  profiles: Record<RuntimeProfileKey, Omit<RuntimeProfile, 'key'>>
}

const contract = runtimeProfileContract as RuntimeProfileDocument

function cleanKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function profileInput(value: string | null | undefined): string | null | undefined {
  return value ?? process.env.ZAMAPAY_RUNTIME_PROFILE ?? process.env.NEXT_PUBLIC_RUNTIME_PROFILE
}

export function normalizeRuntimeProfile(value?: string | null): RuntimeProfileKey {
  const raw = cleanKey(profileInput(value))
  const key = raw || contract.defaultProfile

  if (!Object.hasOwn(contract.profiles, key)) {
    throw new Error(`Unsupported runtime profile "${value}".`)
  }

  return key as RuntimeProfileKey
}

export function runtimeProfile(value?: string | null): RuntimeProfile {
  const key = normalizeRuntimeProfile(value)
  return {
    key,
    ...contract.profiles[key],
  }
}

export function activeRuntimeProfile(): RuntimeProfile {
  return runtimeProfile(process.env.ZAMAPAY_RUNTIME_PROFILE ?? process.env.NEXT_PUBLIC_RUNTIME_PROFILE)
}

export function contractEnvironmentFromRuntimeProfile(value?: string | null): ContractEnvironment {
  return runtimeProfile(value).contractEnvironment
}

export function projectEnvironmentFromRuntimeProfile(value?: string | null): ProjectEnvironmentValue {
  return runtimeProfile(value).projectEnvironment
}

export function runtimeProfileForContractEnvironment(environment: ContractEnvironment): RuntimeProfile {
  return runtimeProfile(environment === 'local-dev' ? 'local-dev' : 'sepolia-local-ui')
}

export function runtimeEnvValue(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

export function runtimeValue(
  profile: RuntimeProfile,
  envField: UrlEnvField,
  fallbackField: UrlFallbackField,
): string | null {
  return runtimeEnvValue(profile[envField]) ?? profile[fallbackField]
}

export function runtimeUrl(
  profile: RuntimeProfile,
  envField: UrlEnvField,
  fallbackField: UrlFallbackField,
  label: string,
): string {
  const value = runtimeValue(profile, envField, fallbackField)
  if (!value) {
    throw new Error(`${label} is not configured for ${profile.key}.`)
  }

  return normalizedUrl(value, label)
}

export function runtimeOptionalUrl(
  profile: RuntimeProfile,
  envField: UrlEnvField,
  fallbackField: UrlFallbackField,
  label: string,
): string | null {
  const value = runtimeValue(profile, envField, fallbackField)
  return value ? normalizedUrl(value, label) : null
}

export function runtimeApiBaseUrl(): string {
  return runtimeUrl(activeRuntimeProfile(), 'apiBaseEnv', 'defaultApiBaseUrl', 'API base URL')
}

export function runtimeWebBaseUrl(): string {
  return runtimeUrl(activeRuntimeProfile(), 'webBaseEnv', 'defaultWebBaseUrl', 'web base URL')
}

export function runtimeCheckoutBaseUrl(): string {
  return runtimeUrl(activeRuntimeProfile(), 'checkoutBaseEnv', 'defaultCheckoutBaseUrl', 'checkout base URL')
}

export function runtimeFinalityConfig(): { confirmations: number; finalityThreshold: number } {
  const profile = activeRuntimeProfile()
  const confirmations = positiveInteger(process.env.CONFIRMATIONS, profile.confirmations, 'CONFIRMATIONS')
  const finalityThreshold = positiveInteger(
    process.env.FINALITY_THRESHOLD,
    profile.finalityThreshold,
    'FINALITY_THRESHOLD',
  )
  if (confirmations < finalityThreshold) {
    throw new Error(`CONFIRMATIONS (${confirmations}) must be >= FINALITY_THRESHOLD (${finalityThreshold}).`)
  }

  return { confirmations, finalityThreshold }
}

function normalizedUrl(value: string, label: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    throw new Error(`${label} is not a valid URL: ${value}`)
  }
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`)
  }

  return value
}
