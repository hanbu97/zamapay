import { defineChain } from 'viem'
import {
  confidentialInvoiceSettlementAbi,
  confidentialUsdMockAbi,
  merchantRegistryAbi,
} from '../../../generated/clients/ts/contracts'

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

export { confidentialInvoiceSettlementAbi, confidentialUsdMockAbi, merchantRegistryAbi }
