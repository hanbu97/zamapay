const fs = require('fs')
const path = require('path')

const CONTRACTS = [
  {
    name: 'MerchantRegistry',
    artifactPath: 'artifacts/contracts/MerchantRegistry.sol/MerchantRegistry.json',
  },
  {
    name: 'ConfidentialUSDMock',
    artifactPath: 'artifacts/contracts/ConfidentialUSDMock.sol/ConfidentialUSDMock.json',
  },
  {
    name: 'ConfidentialInvoiceSettlement',
    artifactPath: 'artifacts/contracts/ConfidentialInvoiceSettlement.sol/ConfidentialInvoiceSettlement.json',
  },
]

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function readArtifact(contractsDir, relativeArtifactPath) {
  const absolutePath = path.join(contractsDir, relativeArtifactPath)
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

function defaultManifest() {
  return {
    network: 'local-dev',
    chainId: null,
    contracts: {
      MerchantRegistry: null,
      ConfidentialUSDMock: null,
      ConfidentialInvoiceSettlement: null,
    },
    generatedAt: new Date().toISOString(),
  }
}

function manifestFileName(manifest) {
  if (manifest.chainId === 11155111 || manifest.network === 'sepolia') {
    return 'sepolia.json'
  }

  return 'local-dev.json'
}

function manifestConstName(fileName) {
  return fileName
    .replace(/\.json$/, '')
    .replace(/(^|-)([a-z])/g, (_match, _prefix, letter) => letter.toUpperCase())
    .replace(/^./, (letter) => letter.toLowerCase())
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function readExistingManifests(projectRoot) {
  const addressDir = path.join(projectRoot, 'generated', 'contracts', 'addresses')

  if (!fs.existsSync(addressDir)) {
    return {}
  }

  return Object.fromEntries(
    fs
      .readdirSync(addressDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => [fileName, readManifest(path.join(addressDir, fileName))])
      .filter((entry) => entry[1] !== null),
  )
}

function rustConstName(fileName) {
  return fileName
    .replace(/\.json$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toUpperCase()
}

function writeGeneratedClients(projectRoot, artifacts, manifest) {
  const generatedRoot = path.join(projectRoot, 'generated')
  const abiDir = path.join(generatedRoot, 'contracts', 'abi')
  const addressDir = path.join(generatedRoot, 'contracts', 'addresses')
  const tsClientDir = path.join(generatedRoot, 'clients', 'ts')
  const rustClientDir = path.join(generatedRoot, 'clients', 'rust')

  ensureDir(abiDir)
  ensureDir(addressDir)
  ensureDir(tsClientDir)
  ensureDir(rustClientDir)

  for (const [name, artifact] of Object.entries(artifacts)) {
    fs.writeFileSync(path.join(abiDir, `${name}.json`), `${JSON.stringify(artifact.abi, null, 2)}\n`)
  }

  const manifests = {
    ...readExistingManifests(projectRoot),
    [manifestFileName(manifest)]: manifest,
  }

  for (const [fileName, addressManifest] of Object.entries(manifests)) {
    fs.writeFileSync(path.join(addressDir, fileName), `${JSON.stringify(addressManifest, null, 2)}\n`)
  }

  const manifestEntriesSource = Object.entries(manifests)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, addressManifest]) => `  ${JSON.stringify(fileName.replace(/\.json$/, ''))}: ${JSON.stringify(addressManifest, null, 2)},`)
    .join('\n')
  const manifestConstSource = Object.keys(manifests)
    .sort()
    .map((fileName) => {
      const key = fileName.replace(/\.json$/, '')
      return `export const ${manifestConstName(fileName)}Addresses = addressManifests[${JSON.stringify(key)}] ?? null`
    })
    .join('\n')

  const tsSource = `export const contractNames = ['MerchantRegistry', 'ConfidentialUSDMock', 'ConfidentialInvoiceSettlement'] as const

export type ContractName = (typeof contractNames)[number]

export type AddressManifest = {
  network: string
  chainId: number | null
  contracts: Record<ContractName, \`0x\${string}\` | null>
  generatedAt: string
  deployer?: \`0x\${string}\` | null
}

export const merchantRegistryAbi = ${JSON.stringify(artifacts.MerchantRegistry.abi, null, 2)} as const
export const confidentialUsdMockAbi = ${JSON.stringify(artifacts.ConfidentialUSDMock.abi, null, 2)} as const
export const confidentialInvoiceSettlementAbi = ${JSON.stringify(artifacts.ConfidentialInvoiceSettlement.abi, null, 2)} as const

export const abis = {
  MerchantRegistry: merchantRegistryAbi,
  ConfidentialUSDMock: confidentialUsdMockAbi,
  ConfidentialInvoiceSettlement: confidentialInvoiceSettlementAbi,
} as const

export const addressManifests = {
${manifestEntriesSource}
} as const satisfies Record<string, AddressManifest>

${manifestConstSource}
`

  fs.writeFileSync(path.join(tsClientDir, 'contracts.ts'), tsSource)

  const manifestRustSource = Object.entries(manifests)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, addressManifest]) => {
      return `pub const ${rustConstName(fileName)}_MANIFEST_JSON: &str = r#"
${JSON.stringify(addressManifest, null, 2)}
"#;`
    })
    .join('\n\n')

  const rustSource = `pub const ADDRESS_MANIFESTS_JSON: &str = r#"
${JSON.stringify(Object.fromEntries(Object.entries(manifests).map(([fileName, addressManifest]) => [fileName.replace(/\.json$/, ''), addressManifest])), null, 2)}
"#;

${manifestRustSource}

pub const MERCHANT_REGISTRY_ABI_JSON: &str = r#"
${JSON.stringify(artifacts.MerchantRegistry.abi, null, 2)}
"#;

pub const CONFIDENTIAL_USD_MOCK_ABI_JSON: &str = r#"
${JSON.stringify(artifacts.ConfidentialUSDMock.abi, null, 2)}
"#;

pub const CONFIDENTIAL_INVOICE_SETTLEMENT_ABI_JSON: &str = r#"
${JSON.stringify(artifacts.ConfidentialInvoiceSettlement.abi, null, 2)}
"#;
`

  fs.writeFileSync(path.join(rustClientDir, 'contracts.rs'), rustSource)
}

function syncGenerated({ manifest } = {}) {
  const contractsDir = path.resolve(__dirname, '..')
  const projectRoot = path.resolve(contractsDir, '..')
  const artifacts = Object.fromEntries(
    CONTRACTS.map(({ name, artifactPath }) => [name, readArtifact(contractsDir, artifactPath)]),
  )
  const existingManifests = readExistingManifests(projectRoot)
  const nextManifest = manifest ?? existingManifests['local-dev.json'] ?? defaultManifest()

  writeGeneratedClients(projectRoot, artifacts, nextManifest)
}

if (require.main === module) {
  syncGenerated()
}

module.exports = {
  CONTRACTS,
  defaultManifest,
  manifestFileName,
  syncGenerated,
  writeGeneratedClients,
}
