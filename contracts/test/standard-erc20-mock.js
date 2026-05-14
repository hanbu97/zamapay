const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('StandardERC20Mock', function () {
  it('emits canonical Transfer logs for local ERC20 rail indexing', async function () {
    const [owner, buyer, receiver] = await ethers.getSigners()
    const Token = await ethers.getContractFactory('StandardERC20Mock')
    const token = await Token.deploy('Local USDT', 'USDT', 6)
    await token.waitForDeployment()

    await expect(token.connect(buyer).claimTestTokens())
      .to.emit(token, 'Transfer')
      .withArgs(ethers.ZeroAddress, buyer.address, 1_000_000_000n)

    await expect(token.connect(buyer).transfer(receiver.address, 120_000_000n))
      .to.emit(token, 'Transfer')
      .withArgs(buyer.address, receiver.address, 120_000_000n)

    expect(await token.balanceOf(receiver.address)).to.equal(120_000_000n)
    expect(await token.owner()).to.equal(owner.address)
  })
})
