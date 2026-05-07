# Testnet Configuration

## Public Sepolia values

These values are public network configuration, not application secrets.

| Name | Value | Source |
| --- | --- | --- |
| FHEVM host chain | Ethereum Sepolia | Zama Relayer SDK initialization docs |
| FHEVM host chain id | `11155111` | Zama Relayer SDK initialization docs |
| Gateway chain id | `10901` | Zama Relayer SDK initialization docs |
| Default RPC used by this repo | `https://ethereum-sepolia-rpc.publicnode.com` | Zama example and repo `.env` |
| Zama relayer URL | `https://relayer.testnet.zama.org` | Zama contract-address docs |
| ACL contract | `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D` | Zama contract-address docs |
| KMS verifier contract | `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A` | Zama contract-address docs |
| Input verifier contract | `0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0` | Zama contract-address docs |
| Decryption verifying address | `0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478` | Zama contract-address docs |
| Input verification address | `0x483b9dE06E4E4C7D35CCf5837A1668487406D955` | Zama contract-address docs |
| FHEVM executor contract | `0x92C920834Ec8941d2C77D188936E1f7A6f49c127` | Zama contract-address docs |
| HCU limit contract | `0xa10998783c8CF88D886Bc30307e631D6686F0A22` | Zama contract-address docs |

The web app does not duplicate these constants. `apps/web/lib/fhevm.ts` imports `SepoliaConfig` from `@zama-fhe/relayer-sdk/bundle` and injects the browser wallet provider as `network`.

## Local `.env` status

The current workspace `.env` contains:

- `NEXT_PUBLIC_CONTRACT_ENV=sepolia`
- `SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com`
- non-default random values for `MERMER_OPERATOR_KEY`, `MERMER_WEBHOOK_SECRET`, and `MERMER_GATEWAY_CALLBACK_KEY`

The current workspace `.env` now contains generated throwaway demo wallets:

- `DEPLOYER_ADDRESS=0xcaA3F62150E5813A52c329498dBefa913B49f2dE`
- `BUYER_ADDRESS=0xC431773Fbc13B36384077847B884dE5D8dB91618`

Both addresses are funded on Sepolia. The deployer pays contract deployment gas. The buyer pays browser checkout gas and received the confidential test-USD mint. Private keys are stored only in the ignored local `.env`; back them up in a password manager before deleting this workspace.

Current readiness evidence:

- `npm run verify:sepolia` passed at Sepolia block `10804469`.
- Deployer signer is recognized with `0.049996565190996466 ETH` after deployment.
- Buyer address is valid with `0.05 ETH`.
- `generated/contracts/addresses/sepolia.json` exists and Rust serves it at `http://127.0.0.1:8080/api/contracts/sepolia`.

Demo wallet addresses:

```text
Deployer: 0xcaA3F62150E5813A52c329498dBefa913B49f2dE
Buyer:    0xC431773Fbc13B36384077847B884dE5D8dB91618
```

Sepolia deployment:

```text
MerchantRegistry:                 0xD3E6345A856a4339effe3cf128745db2CAa4D2d1
ConfidentialUSDMock:              0x473FBc0B9761F1E879c22971D9b77134f03C42bE
ConfidentialInvoiceSettlement:    0x6975Bba2F12F47a49028120C6c51fBc9D2Fd6015
Buyer test-USD mint tx:           0x5c7838ce7a110e687cdc282cd7e50c50aa06cdf89871cf29bc649644dd6d0483
```

Faucet pages checked in the browser during setup:

- `https://ethglobal.com/faucet/sepolia-11155111-eth`: opens, but requires ETHGlobal login.
- `https://sepolia-faucet.pk910.de/`: opens and accepts the deployer address, but `Start Mining` returns `[IPINFO_RESTRICTION] IP Blocked: You're connecting from a hosting IP range.` from the current environment.

Browser evidence:

- `/Users/hanbu/MyProjects/hackerthon/zama/predict/mermer-sepolia-pow-faucet-ip-blocked-20260507.png`

## Official references

- Zama Relayer SDK initialization: `https://docs.zama.org/protocol/relayer-sdk-guides/fhevm-relayer/initialization`
- Zama Sepolia contract addresses: `https://docs.zama.org/protocol/solidity-guides/smart-contract/configure/contract_addresses`
