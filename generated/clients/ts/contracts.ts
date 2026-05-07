export const contractNames = ['MerchantRegistry', 'ConfidentialUSDMock', 'ConfidentialInvoiceSettlement'] as const

export type ContractName = (typeof contractNames)[number]

export type AddressManifest = {
  network: string
  chainId: number | null
  contracts: Record<ContractName, `0x${string}` | null>
  generatedAt: string
  deployer?: `0x${string}` | null
}

export const merchantRegistryAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payoutWallet",
        "type": "address"
      }
    ],
    "name": "MerchantPayoutWalletUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payoutWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "label",
        "type": "string"
      }
    ],
    "name": "MerchantRegistered",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      }
    ],
    "name": "isMerchant",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      }
    ],
    "name": "merchantOf",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "payoutWallet",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "label",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          }
        ],
        "internalType": "struct MerchantRegistry.Merchant",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      }
    ],
    "name": "payoutWalletOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "payoutWallet",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "label",
        "type": "string"
      }
    ],
    "name": "registerMerchant",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "payoutWallet",
        "type": "address"
      }
    ],
    "name": "updatePayoutWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const
export const confidentialUsdMockAbi = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "handle",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "SenderNotAllowedToUseHandle",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZamaProtocolUnsupported",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "expectedAmount",
        "type": "uint64"
      }
    ],
    "name": "ConditionalTransfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "Mint",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenOwner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "externalEuint64",
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "inputProof",
        "type": "bytes"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "externalEuint64",
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "inputProof",
        "type": "bytes"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "externalEuint64",
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "inputProof",
        "type": "bytes"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "euint64",
        "name": "amount",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "expectedAmount",
        "type": "uint64"
      }
    ],
    "name": "transferFromExact",
    "outputs": [
      {
        "internalType": "ebool",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const
export const confidentialInvoiceSettlementAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "merchantRegistryAddress",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "settlementTokenAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "InvalidKMSSignatures",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "handle",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "SenderNotAllowedToUseHandle",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZamaProtocolUnsupported",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "externalRef",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amountDue",
        "type": "uint64"
      }
    ],
    "name": "InvoiceCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      }
    ],
    "name": "InvoiceExpired",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      }
    ],
    "name": "InvoicePaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      }
    ],
    "name": "InvoicePaymentRejected",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "paymentCheckHandle",
        "type": "bytes32"
      }
    ],
    "name": "InvoicePaymentSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bytes32[]",
        "name": "handlesList",
        "type": "bytes32[]"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "abiEncodedCleartexts",
        "type": "bytes"
      }
    ],
    "name": "PublicDecryptionVerified",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "confidentialProtocolId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "externalRef",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "amountDue",
        "type": "uint64"
      }
    ],
    "name": "createInvoice",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      }
    ],
    "name": "expireInvoice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "abiEncodedPaymentAccepted",
        "type": "bytes"
      },
      {
        "internalType": "bytes",
        "name": "decryptionProof",
        "type": "bytes"
      }
    ],
    "name": "finalizePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "invoiceCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "invoices",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "merchant",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "payoutWallet",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "externalRef",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "internalType": "uint64",
        "name": "amountDue",
        "type": "uint64"
      },
      {
        "internalType": "enum ConfidentialInvoiceSettlement.PaymentTruth",
        "name": "paymentTruth",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "payer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "paidAt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "merchantRegistry",
    "outputs": [
      {
        "internalType": "contract IMerchantRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      },
      {
        "internalType": "externalEuint64",
        "name": "encryptedAmount",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "inputProof",
        "type": "bytes"
      }
    ],
    "name": "payInvoice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      }
    ],
    "name": "paymentCheckHandleOf",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      }
    ],
    "name": "settledAmountHandleOf",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "invoiceId",
        "type": "uint256"
      }
    ],
    "name": "settledAmountOf",
    "outputs": [
      {
        "internalType": "euint64",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "settlementToken",
    "outputs": [
      {
        "internalType": "contract IConfidentialUSD",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const

export const abis = {
  MerchantRegistry: merchantRegistryAbi,
  ConfidentialUSDMock: confidentialUsdMockAbi,
  ConfidentialInvoiceSettlement: confidentialInvoiceSettlementAbi,
} as const

export const addressManifests = {
  "local-dev": {
  "network": "localhost",
  "chainId": 31337,
  "contracts": {
    "MerchantRegistry": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "ConfidentialUSDMock": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "ConfidentialInvoiceSettlement": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
  },
  "generatedAt": "2026-05-06T14:07:03.659Z",
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
},
  "sepolia": {
  "network": "sepolia",
  "chainId": 11155111,
  "contracts": {
    "MerchantRegistry": "0xD3E6345A856a4339effe3cf128745db2CAa4D2d1",
    "ConfidentialUSDMock": "0x473FBc0B9761F1E879c22971D9b77134f03C42bE",
    "ConfidentialInvoiceSettlement": "0x6975Bba2F12F47a49028120C6c51fBc9D2Fd6015"
  },
  "generatedAt": "2026-05-07T00:22:26.915Z",
  "deployer": "0xcaA3F62150E5813A52c329498dBefa913B49f2dE"
},
} as const satisfies Record<string, AddressManifest>

export const localDevAddresses = addressManifests["local-dev"] ?? null
export const sepoliaAddresses = addressManifests["sepolia"] ?? null
