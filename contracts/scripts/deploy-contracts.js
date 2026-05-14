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
  const platformFeeWallet = process.env.ZAMAPAY_PLATFORM_FEE_WALLET || deployer.address
  const evmWithdrawAuthorizer = process.env.ZAMAPAY_EVM_WITHDRAW_AUTHORIZER
    ? ethers.getAddress(process.env.ZAMAPAY_EVM_WITHDRAW_AUTHORIZER)
    : deployer.address

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
  await (await token.setPrivateDebitOperator(await subscriptionRegistry.getAddress(), true)).wait()

  const privateCheckoutFactory = await ethers.getContractFactory('PrivateCheckoutSettlement')
  const privateCheckout = await privateCheckoutFactory.deploy(await token.getAddress())
  await privateCheckout.waitForDeployment()
  await (await token.setSettlement(await privateCheckout.getAddress())).wait()
  await (await subscriptionRegistry.setSettlement(await privateCheckout.getAddress())).wait()

  const standardErc20Factory = await ethers.getContractFactory('StandardERC20Mock')
  const standardUsdt = await standardErc20Factory.deploy('Local USDT', 'USDT', 6)
  await standardUsdt.waitForDeployment()
  const standardUsdc = await standardErc20Factory.deploy('Local USDC', 'USDC', 6)
  await standardUsdc.waitForDeployment()

  const evmCheckoutFactory = await ethers.getContractFactory('EvmCheckoutSettlement')
  const evmCheckout = await evmCheckoutFactory.deploy(evmWithdrawAuthorizer, platformFeeWallet)
  await evmCheckout.waitForDeployment()

  const network = await ethers.provider.getNetwork()
  const billing = await readBillingProtocol({ subscriptionRegistry })
  const manifest = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    contracts: {
      MerchantRegistry: await registry.getAddress(),
      ConfidentialUSDMock: await token.getAddress(),
      SubscriptionPass: await pass.getAddress(),
      PrivateSubscriptionRegistry: await subscriptionRegistry.getAddress(),
      PrivateCheckoutSettlement: await privateCheckout.getAddress(),
      EvmCheckoutSettlement: await evmCheckout.getAddress(),
    },
    billing,
    testTokenFaucet: {
      token: await token.getAddress(),
      claimAmountMinorUnits: '1000000000',
      functionName: 'claimTestTokens',
    },
    standardErc20Tokens: [
      {
        symbol: 'USDT',
        contract: await standardUsdt.getAddress(),
        decimals: 6,
        faucetFunctionName: 'claimTestTokens',
      },
      {
        symbol: 'USDC',
        contract: await standardUsdc.getAddress(),
        decimals: 6,
        faucetFunctionName: 'claimTestTokens',
      },
    ],
    generatedAt: new Date().toISOString(),
    deployer: deployer.address,
    platformFeeWallet,
    evmWithdrawAuthorizer,
  }

  writeGeneratedClients(
    require('path').resolve(__dirname, '..', '..'),
    {
      MerchantRegistry: await hre.artifacts.readArtifact('MerchantRegistry'),
      ConfidentialUSDMock: await hre.artifacts.readArtifact('ConfidentialUSDMock'),
      SubscriptionPass: await hre.artifacts.readArtifact('SubscriptionPass'),
      PrivateSubscriptionRegistry: await hre.artifacts.readArtifact('PrivateSubscriptionRegistry'),
      PrivateCheckoutSettlement: await hre.artifacts.readArtifact('PrivateCheckoutSettlement'),
      EvmCheckoutSettlement: await hre.artifacts.readArtifact('EvmCheckoutSettlement'),
    },
    manifest,
  )

  console.log(JSON.stringify(manifest, null, 2))
}

async function readBillingProtocol({ subscriptionRegistry }) {
  const [
    freePlanCode,
    growthPlanCode,
    freeFeeBps,
    growthFeeBps,
    growthMonthlyPrice,
    growthAnnualPrice,
    monthlyPeriodSeconds,
    annualPeriodSeconds,
  ] = await Promise.all([
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
    defaultFeeBps: Number(freeFeeBps),
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
