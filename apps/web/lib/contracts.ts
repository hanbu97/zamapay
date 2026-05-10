import { defineChain } from 'viem'
import type { AddressManifest } from '../../../generated/clients/ts/contracts.ts'
import {
  addressManifests,
  confidentialUsdMockAbi,
  merchantRegistryAbi,
  localDevAddresses,
  privateCheckoutSettlementAbi,
  privateSubscriptionRegistryAbi,
  subscriptionPassAbi,
} from '../../../generated/clients/ts/contracts.ts'

export type { AddressManifest }

export const localHardhat = defineChain({
  id: 31337,
  name: 'Hardhat Local',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8545'],
    },
  },
})

export const sepolia = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Sepolia Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Etherscan',
      url: 'https://sepolia.etherscan.io',
    },
  },
  testnet: true,
})

export const sepoliaAddresses = (addressManifests as Record<string, AddressManifest>)['sepolia'] ?? null

export {
  confidentialUsdMockAbi,
  localDevAddresses,
  merchantRegistryAbi,
  privateCheckoutSettlementAbi,
  privateSubscriptionRegistryAbi,
  subscriptionPassAbi,
}
