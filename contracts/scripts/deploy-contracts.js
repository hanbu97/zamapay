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
  const platformFeeWallet = process.env.MERMER_PLATFORM_FEE_WALLET || deployer.address

  const registryFactory = await ethers.getContractFactory('MerchantRegistry')
  const registry = await registryFactory.deploy()
  await registry.waitForDeployment()

  const tokenFactory = await ethers.getContractFactory('ConfidentialUSDMock')
  const token = await tokenFactory.deploy()
  await token.waitForDeployment()

  const passFactory = await ethers.getContractFactory('SubscriptionPass')
  const pass = await passFactory.deploy()
  await pass.waitForDeployment()

  const subscriptionRegistryFactory = await ethers.getContractFactory('PrivateSubscriptionRegistry')
  const subscriptionRegistry = await subscriptionRegistryFactory.deploy(
    await pass.getAddress(),
    await token.getAddress(),
    platformFeeWallet,
  )
  await subscriptionRegistry.waitForDeployment()
  await (await pass.setMinter(await subscriptionRegistry.getAddress())).wait()

  const settlementFactory = await ethers.getContractFactory('ConfidentialInvoiceSettlement')
  const settlement = await settlementFactory.deploy(
    await registry.getAddress(),
    await subscriptionRegistry.getAddress(),
    await token.getAddress(),
    platformFeeWallet,
  )
  await settlement.waitForDeployment()
  await (await subscriptionRegistry.setSettlement(await settlement.getAddress())).wait()

  const network = await ethers.provider.getNetwork()
  const billing = await readBillingProtocol({ settlement, subscriptionRegistry })
  const manifest = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    contracts: {
      MerchantRegistry: await registry.getAddress(),
      ConfidentialUSDMock: await token.getAddress(),
      SubscriptionPass: await pass.getAddress(),
      PrivateSubscriptionRegistry: await subscriptionRegistry.getAddress(),
      ConfidentialInvoiceSettlement: await settlement.getAddress(),
    },
    billing,
    generatedAt: new Date().toISOString(),
    deployer: deployer.address,
    platformFeeWallet,
  }

  writeGeneratedClients(
    require('path').resolve(__dirname, '..', '..'),
    {
      MerchantRegistry: await hre.artifacts.readArtifact('MerchantRegistry'),
      ConfidentialUSDMock: await hre.artifacts.readArtifact('ConfidentialUSDMock'),
      SubscriptionPass: await hre.artifacts.readArtifact('SubscriptionPass'),
      PrivateSubscriptionRegistry: await hre.artifacts.readArtifact('PrivateSubscriptionRegistry'),
      ConfidentialInvoiceSettlement: await hre.artifacts.readArtifact('ConfidentialInvoiceSettlement'),
    },
    manifest,
  )

  console.log(JSON.stringify(manifest, null, 2))
}

async function readBillingProtocol({ settlement, subscriptionRegistry }) {
  const [
    defaultFeeBps,
    freePlanCode,
    growthPlanCode,
    freeFeeBps,
    growthFeeBps,
    growthMonthlyPrice,
    growthAnnualPrice,
    monthlyPeriodSeconds,
    annualPeriodSeconds,
  ] = await Promise.all([
    settlement.DEFAULT_FEE_BPS(),
    subscriptionRegistry.FREE_PLAN_CODE(),
    subscriptionRegistry.GROWTH_PLAN_CODE(),
    subscriptionRegistry.FREE_FEE_BPS(),
    subscriptionRegistry.GROWTH_FEE_BPS(),
    subscriptionRegistry.GROWTH_MONTHLY_PRICE_MINOR_UNITS(),
    subscriptionRegistry.GROWTH_ANNUAL_PRICE_MINOR_UNITS(),
    subscriptionRegistry.MONTHLY_PERIOD_SECONDS(),
    subscriptionRegistry.ANNUAL_PERIOD_SECONDS(),
  ])

  return {
    source: 'PrivateSubscriptionRegistry',
    defaultFeeBps: Number(defaultFeeBps),
    monthlyPeriodSeconds: Number(monthlyPeriodSeconds),
    annualPeriodSeconds: Number(annualPeriodSeconds),
    plans: [
      {
        plan: 'free',
        planCode: Number(freePlanCode),
        checkoutFeeBps: Number(freeFeeBps),
        monthlyPriceMinorUnits: 0,
        annualPriceMinorUnits: 0,
        selfServe: true,
      },
      {
        plan: 'growth',
        planCode: Number(growthPlanCode),
        checkoutFeeBps: Number(growthFeeBps),
        monthlyPriceMinorUnits: Number(growthMonthlyPrice),
        annualPriceMinorUnits: Number(growthAnnualPrice),
        selfServe: true,
      },
      {
        plan: 'enterprise',
        planCode: null,
        checkoutFeeBps: null,
        monthlyPriceMinorUnits: null,
        annualPriceMinorUnits: null,
        selfServe: false,
      },
    ],
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
