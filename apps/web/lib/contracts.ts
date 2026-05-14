import { defineChain } from 'viem'
import type { AddressManifest } from '../../../generated/clients/ts/contracts.ts'
import {
  addressManifests,
  confidentialUsdMockAbi,
  evmCheckoutSettlementAbi,
  merchantRegistryAbi,
  localDevAddresses,
  privateCheckoutSettlementAbi,
  privateSubscriptionRegistryAbi,
  subscriptionPassAbi,
} from '../../../generated/clients/ts/contracts.ts'
import { runtimeOptionalUrl, runtimeProfileForContractEnvironment } from './runtime-profile.ts'

export type { AddressManifest }

const localProfile = runtimeProfileForContractEnvironment('local-dev')
const sepoliaProfile = runtimeProfileForContractEnvironment('sepolia')
const localRpcUrl = runtimeOptionalUrl(localProfile, 'rpcEnv', 'defaultRpcUrl', 'local RPC URL')!
const sepoliaRpcUrl =
  runtimeOptionalUrl(sepoliaProfile, 'rpcEnv', 'defaultRpcUrl', 'Sepolia RPC URL') ??
  'https://sepolia-rpc-unconfigured.zamapay.invalid'
const sepoliaExplorerUrl = runtimeOptionalUrl(
  sepoliaProfile,
  'explorerEnv',
  'defaultExplorerUrl',
  'Sepolia block explorer URL',
)

export const localHardhat = defineChain({
  id: localProfile.chainId,
  name: localProfile.chainName,
  nativeCurrency: localProfile.nativeCurrency,
  rpcUrls: {
    default: {
      http: [localRpcUrl],
    },
  },
})

export const sepolia = defineChain({
  id: sepoliaProfile.chainId,
  name: sepoliaProfile.chainName,
  nativeCurrency: sepoliaProfile.nativeCurrency,
  rpcUrls: {
    default: {
      http: [sepoliaRpcUrl],
    },
  },
  blockExplorers: sepoliaExplorerUrl ? { default: { name: 'Etherscan', url: sepoliaExplorerUrl } } : undefined,
  testnet: true,
})

export const sepoliaAddresses = (addressManifests as Record<string, AddressManifest>)['sepolia'] ?? null

export {
  confidentialUsdMockAbi,
  evmCheckoutSettlementAbi,
  localDevAddresses,
  merchantRegistryAbi,
  privateCheckoutSettlementAbi,
  privateSubscriptionRegistryAbi,
  subscriptionPassAbi,
}
