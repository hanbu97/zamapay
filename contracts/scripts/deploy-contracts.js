const hre = require('hardhat')
const { assertSafePublicNetworkSigner } = require('./public-hardhat-keys')
const { writeGeneratedClients } = require('./sync-generated')

async function main() {
  const { ethers } = hre
  const [deployer] = await ethers.getSigners()

  if (!deployer) {
    throw new Error('No deployer signer configured. Set DEPLOYER_PRIVATE_KEY for non-local networks.')
  }

  await assertSafePublicNetworkSigner(hre, deployer, 'deployer')

  const registryFactory = await ethers.getContractFactory('MerchantRegistry')
  const registry = await registryFactory.deploy()
  await registry.waitForDeployment()

  const tokenFactory = await ethers.getContractFactory('ConfidentialUSDMock')
  const token = await tokenFactory.deploy()
  await token.waitForDeployment()

  const settlementFactory = await ethers.getContractFactory('ConfidentialInvoiceSettlement')
  const settlement = await settlementFactory.deploy(await registry.getAddress(), await token.getAddress())
  await settlement.waitForDeployment()

  const network = await ethers.provider.getNetwork()
  const manifest = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    contracts: {
      MerchantRegistry: await registry.getAddress(),
      ConfidentialUSDMock: await token.getAddress(),
      ConfidentialInvoiceSettlement: await settlement.getAddress(),
    },
    generatedAt: new Date().toISOString(),
    deployer: deployer.address,
  }

  writeGeneratedClients(
    require('path').resolve(__dirname, '..', '..'),
    {
      MerchantRegistry: await hre.artifacts.readArtifact('MerchantRegistry'),
      ConfidentialUSDMock: await hre.artifacts.readArtifact('ConfidentialUSDMock'),
      ConfidentialInvoiceSettlement: await hre.artifacts.readArtifact('ConfidentialInvoiceSettlement'),
    },
    manifest,
  )

  console.log(JSON.stringify(manifest, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
