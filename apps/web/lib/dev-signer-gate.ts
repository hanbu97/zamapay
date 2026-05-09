import { normalizeContractEnvironment } from './contract-environment.ts'

export type DevSignerGateInput = {
  contractEnv?: string
  enableDevSigner?: string
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

function safeContractEnvironment(value: string | undefined): 'local-dev' | 'sepolia' | 'invalid' {
  try {
    return normalizeContractEnvironment(value)
  } catch {
    return 'invalid'
  }
}
