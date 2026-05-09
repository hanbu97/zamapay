import { defineChain } from 'viem'
import type { AddressManifest } from '../../../generated/clients/ts/contracts.ts'
import {
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

export {
  confidentialUsdMockAbi,
  localDevAddresses,
  merchantRegistryAbi,
  privateCheckoutSettlementAbi,
  privateSubscriptionRegistryAbi,
  subscriptionPassAbi,
}
