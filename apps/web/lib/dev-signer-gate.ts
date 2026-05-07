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
  return (
    input.enableDevSigner === '1' &&
    input.nodeEnv !== 'production' &&
    input.contractEnv !== 'sepolia' &&
    isLocalRequestUrl(input.requestUrl)
  )
}
