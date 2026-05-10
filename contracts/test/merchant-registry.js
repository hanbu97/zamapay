const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MerchantRegistry", function () {
  it("registers a merchant and updates payout wallet", async function () {
    const [merchant, nextWallet] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("MerchantRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await expect(registry.connect(merchant).registerMerchant(merchant.address, "ZamaPay Demo")).to.emit(
      registry,
      "MerchantRegistered",
    );

    expect(await registry.isMerchant(merchant.address)).to.equal(true);

    await expect(registry.connect(merchant).updatePayoutWallet(nextWallet.address)).to.emit(
      registry,
      "MerchantPayoutWalletUpdated",
    );
  });
});
