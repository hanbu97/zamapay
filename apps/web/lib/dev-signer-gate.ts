import { normalizeContractEnvironment, type ContractEnvironment } from './contract-environment.ts'

export type DevSignerGateInput = {
  contractEnv?: string
  enableDevSigner?: string
  nodeEnv?: string
  requestUrl: string
}

export type LocalDevServerBridgeInput = {
  contractEnv?: string
  nodeEnv?: string
  requestUrl: string
}

export type SepoliaServerBridgeInput = {
  authorizationHeader?: string | null
  nodeEnv?: string
  requestUrl: string
}

export function isLocalRequestUrl(requestUrl: string): boolean {
  const host = new URL(requestUrl).hostname
  return host === '127.0.0.1' || host === 'localhost'
}

export function canUseDevSigner(input: DevSignerGateInput): boolean {
  const contractEnvironment = safeContractEnvironment(input.contractEnv)

  return (
    input.enableDevSigner === '1' &&
    input.nodeEnv !== 'production' &&
    contractEnvironment === 'local-dev' &&
    isLocalRequestUrl(input.requestUrl)
  )
}

export function canUseLocalDevServerBridge(input: LocalDevServerBridgeInput): boolean {
  const contractEnvironment = safeContractEnvironment(input.contractEnv)

  return input.nodeEnv !== 'production' && contractEnvironment === 'local-dev' && isLocalRequestUrl(input.requestUrl)
}

export function canUseSepoliaServerBridge(input: SepoliaServerBridgeInput): boolean {
  if (input.nodeEnv !== 'production' && isLocalRequestUrl(input.requestUrl)) {
    return true
  }

  return bearerToken(input.authorizationHeader) !== null
}

export function bearerToken(headerValue: string | null | undefined): string | null {
  const match = headerValue?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function safeContractEnvironment(value: string | undefined): ContractEnvironment | 'invalid' {
  try {
    return normalizeContractEnvironment(value)
  } catch {
    return 'invalid'
  }
}
