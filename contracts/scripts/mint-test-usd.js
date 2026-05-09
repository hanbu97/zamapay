const path = require('path')
const hre = require('hardhat')
const { assertSafePublicNetworkSigner } = require('./public-hardhat-keys')

function manifestPath(networkName) {
  const environment = networkName === 'localhost' || networkName === 'hardhat' ? 'local-dev' : networkName
  return path.resolve(__dirname, '..', '..', 'generated', 'contracts', 'addresses', `${environment}.json`)
}

function readManifest(networkName) {
  const file = manifestPath(networkName)
  let manifest

  try {
    manifest = require(file)
  } catch (error) {
    throw new Error(`Contract manifest missing at ${file}. Deploy contracts before minting test USD.`)
  }

  const tokenAddress = manifest.contracts?.ConfidentialUSDMock
  if (!tokenAddress) {
    throw new Error(`ConfidentialUSDMock is missing in ${file}.`)
  }

  return { file, manifest, tokenAddress }
}

function parseAmount() {
  const value = process.env.AMOUNT_MINOR_UNITS ?? '1000000000'
  if (!/^\d+$/.test(value)) {
    throw new Error('AMOUNT_MINOR_UNITS must be a positive integer string.')
  }

  const amount = BigInt(value)
  if (amount <= 0n || amount > 18_446_744_073_709_551_615n) {
    throw new Error('AMOUNT_MINOR_UNITS must fit uint64 and be greater than zero.')
  }

  return amount
}

async function resolveBuyerAddress(signers) {
  const configured = process.env.BUYER_ADDRESS
  if (configured) {
    return hre.ethers.getAddress(configured)
  }

  const fallbackBuyer = signers[1]
  if (!fallbackBuyer) {
    throw new Error('BUYER_ADDRESS is required when the network has no second local signer.')
  }

  return fallbackBuyer.address
}

async function main() {
  const signers = await hre.ethers.getSigners()
  const [owner] = signers

  if (!owner) {
    throw new Error('No local token owner signer is configured.')
  }

  await assertSafePublicNetworkSigner(hre, owner, 'token owner')

  const { file, manifest, tokenAddress } = readManifest(hre.network.name)
  const buyerAddress = await resolveBuyerAddress(signers)
  const amount = parseAmount()
  const token = await hre.ethers.getContractAt('ConfidentialUSDMock', tokenAddress)

  const tx = await token.connect(owner).mint(buyerAddress, amount)
  const receipt = await tx.wait()

  console.log(
    JSON.stringify(
      {
        network: hre.network.name,
        chainId: manifest.chainId,
        manifestPath: file,
        token: tokenAddress,
        owner: owner.address,
        buyer: buyerAddress,
        amountMinorUnits: amount.toString(),
        txHash: receipt.hash,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
