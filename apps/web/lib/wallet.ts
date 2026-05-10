export type EthereumRequestArguments = {
  method: string
  params?: unknown[] | object
}

export type EthereumProvider = {
  request(args: EthereumRequestArguments): Promise<unknown>
  on?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
  removeListener?(event: 'accountsChanged', handler: (accounts: string[]) => void): void
}

type Eip6963ProviderDetail = {
  provider?: unknown
}

type WalletSwitchError = {
  code?: unknown
}

export type WalletChain = {
  id: number
  name: string
  nativeCurrency: {
    decimals: number
    name: string
    symbol: string
  }
  rpcUrls: string[]
  blockExplorerUrls?: string[]
}

export const localHardhatWalletChain: WalletChain = {
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: ['http://127.0.0.1:8545'],
}

export const sepoliaWalletChain: WalletChain = {
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Sepolia Ether',
    symbol: 'ETH',
  },
  rpcUrls: [process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export function getInjectedWalletProvider(): EthereumProvider | undefined {
  if (typeof window === 'undefined' || !isEthereumProvider(window.ethereum)) {
    return undefined
  }

  return window.ethereum
}

export function listenForInjectedWalletProvider(onProvider: (provider: EthereumProvider) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const emitProvider = (provider: unknown) => {
    if (isEthereumProvider(provider)) {
      onProvider(provider)
    }
  }
  const handleEip6963Provider = (event: Event) => {
    emitProvider((event as CustomEvent<Eip6963ProviderDetail>).detail?.provider)
  }
  const handleEthereumInitialized = () => emitProvider(window.ethereum)

  window.addEventListener('eip6963:announceProvider', handleEip6963Provider as EventListener)
  window.addEventListener('ethereum#initialized', handleEthereumInitialized, { once: true })
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  queueMicrotask(() => emitProvider(window.ethereum))

  return () => {
    window.removeEventListener('eip6963:announceProvider', handleEip6963Provider as EventListener)
    window.removeEventListener('ethereum#initialized', handleEthereumInitialized)
  }
}

export function ensureEthereumProvider(): EthereumProvider {
  const provider = getInjectedWalletProvider()

  if (!provider) {
    throw new Error('No injected wallet provider found.')
  }

  return provider
}

export function parseWalletAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}

export async function getAuthorizedWalletAccounts(provider: EthereumProvider): Promise<string[]> {
  return parseWalletAccounts(
    await provider.request({
      method: 'eth_accounts',
    }),
  )
}

export async function requestWalletAccounts(provider: EthereumProvider): Promise<string[]> {
  return parseWalletAccounts(
    await provider.request({
      method: 'eth_requestAccounts',
    }),
  )
}

export async function disconnectWalletAccounts(provider: EthereumProvider): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    })
  } catch (caught) {
    if (walletErrorCode(caught) === 4001) {
      throw caught
    }
    if (walletErrorCode(caught) !== -32601) {
      throw caught
    }
  }
}

function isEthereumProvider(value: unknown): value is EthereumProvider {
  return typeof value === 'object' && value !== null && typeof (value as EthereumProvider).request === 'function'
}

function chainIdHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`
}

function walletErrorCode(caught: unknown): unknown {
  if (typeof caught !== 'object' || caught === null) {
    return undefined
  }

  return (caught as WalletSwitchError).code
}

export async function ensureWalletChain(provider: EthereumProvider, chain: WalletChain): Promise<void> {
  const chainId = chainIdHex(chain.id)

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId }],
    })
  } catch (caught) {
    if (walletErrorCode(caught) !== 4902) {
      throw caught
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorerUrls ?? [],
        },
      ],
    })
  }
}
