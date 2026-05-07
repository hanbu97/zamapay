const PUBLIC_HARDHAT_ADDRESSES = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
  '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9',
  '0x14dc79964da2c08b23698b3d3cc7ca32193d9955',
  '0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f',
  '0xa0ee7a142d267c1f36714e4a8f75612f20a79720',
  '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf',
  '0x6813eb9362372eef6200f3b1dbc3f819671cba69',
  '0x1eff47bc3a10a45d4b230b5d10e37751fe6aa718',
  '0xe57bfe9f44b819898f47bf37e5af72a0783e1141',
  '0xd41c057fd1c78805aac12b0a94a405c0461a6fbb',
  '0xf1f6619b413e061dad22b0f0e7f3ec11d3e7aa9b',
  '0xf7edc8fa1ecc32967f827c9043fcae6ba73afaf5',
  '0x4ccedf090dd3512a23a5131ee4cde826fe8e7b98',
  '0x7b4c2937b8d4c5e397ed2dcd9e6c1ef7b829df2a',
])

function isPublicHardhatAddress(address) {
  return PUBLIC_HARDHAT_ADDRESSES.has(address.toLowerCase())
}

function isLocalNetwork(networkName) {
  return networkName === 'hardhat' || networkName === 'localhost'
}

async function assertSafePublicNetworkSigner(hre, signer, role) {
  if (isLocalNetwork(hre.network.name)) {
    return
  }

  const address = await signer.getAddress()
  if (isPublicHardhatAddress(address)) {
    throw new Error(`${role} ${address} is a public Hardhat test address and must not be used on ${hre.network.name}.`)
  }
}

module.exports = {
  assertSafePublicNetworkSigner,
  isPublicHardhatAddress,
}
