export type EthereumRequestArguments = {
  method: string
  params?: unknown[] | object
}

export type EthereumProvider = {
  request(args: EthereumRequestArguments): Promise<unknown>
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
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export function ensureEthereumProvider(): EthereumProvider {
  if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
    throw new Error('No injected wallet provider found.')
  }

  return window.ethereum
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
