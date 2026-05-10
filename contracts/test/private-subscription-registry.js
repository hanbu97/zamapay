const { expect } = require("chai");
const { ethers, fhevm } = require("hardhat");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("PrivateSubscriptionRegistry", function () {
  async function deployFixture() {
    const [deployer, merchant, treasury] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ConfidentialUSDMock");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Pass = await ethers.getContractFactory("SubscriptionPass");
    const pass = await Pass.deploy();
    await pass.waitForDeployment();

    const Registry = await ethers.getContractFactory("PrivateSubscriptionRegistry");
    const registry = await Registry.deploy(
      await pass.getAddress(),
      await token.getAddress(),
      treasury.address,
    );
    await registry.waitForDeployment();
    await pass.setMinter(await registry.getAddress());

    await fhevm.assertCoprocessorInitialized(token, "ConfidentialUSDMock");
    await fhevm.assertCoprocessorInitialized(registry, "PrivateSubscriptionRegistry");

    return { deployer, merchant, treasury, token, pass, registry };
  }

  async function encryptSubscriptionChange(contractAddress, signer, planCode, paidAmount) {
    const input = fhevm.createEncryptedInput(contractAddress, signer.address);
    input.add16(planCode);
    input.add64(paidAmount);
    return input.encrypt();
  }

  async function decryptBool(handle) {
    const proof = await fhevm.publicDecrypt([handle]);

    return {
      accepted: proof.clearValues[handle],
      abiEncodedClearValues: proof.abiEncodedClearValues,
      decryptionProof: proof.decryptionProof,
    };
  }

  async function decrypt64(handle) {
    return BigInt((await fhevm.debugger.decryptEuint(FhevmType.euint64, handle)).toString());
  }

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("upgrades Growth by charging the official local confidential USD token", async function () {
    const { merchant, treasury, token, registry } = await deployFixture();
    const registryAddress = await registry.getAddress();
    const price = 99_000000n;

    await token.setPrivateDebitOperator(registryAddress, true);
    await token.mint(merchant.address, price);

    const upgrade = await encryptSubscriptionChange(registryAddress, merchant, 2n, price);
    await expect(
      registry
        .connect(merchant)
        .requestMerchantSubscriptionChange(merchant.address, upgrade.handles[0], upgrade.handles[1], upgrade.inputProof),
    ).to.emit(registry, "SubscriptionChangeRequested");
    const passId = await registry.passOfMerchant(merchant.address);

    const proof = await decryptBool(await registry.subscriptionCheckHandleOf(passId));
    expect(proof.accepted).to.equal(true);

    await expect(
      registry.finalizeSubscriptionChange(passId, proof.abiEncodedClearValues, proof.decryptionProof),
    ).to.emit(registry, "SubscriptionChangeFinalized");

    expect(await registry.termsVersionOf(passId)).to.equal(2n);
    expect(await decrypt64(await token.balanceOf(merchant.address))).to.equal(0n);
    expect(await decrypt64(await token.balanceOf(treasury.address))).to.equal(price);
  });

  it("rejects a Growth request when the encrypted paid amount does not match the required price", async function () {
    const { merchant, treasury, token, registry } = await deployFixture();
    const registryAddress = await registry.getAddress();
    const price = 99_000000n;
    const wrongPrice = 98_000000n;

    await token.setPrivateDebitOperator(registryAddress, true);
    await token.mint(merchant.address, price);

    const upgrade = await encryptSubscriptionChange(registryAddress, merchant, 2n, wrongPrice);
    await registry
      .connect(merchant)
      .requestMerchantSubscriptionChange(merchant.address, upgrade.handles[0], upgrade.handles[1], upgrade.inputProof);
    const passId = await registry.passOfMerchant(merchant.address);

    const proof = await decryptBool(await registry.subscriptionCheckHandleOf(passId));
    expect(proof.accepted).to.equal(false);

    await registry.finalizeSubscriptionChange(passId, proof.abiEncodedClearValues, proof.decryptionProof);

    expect(await registry.termsVersionOf(passId)).to.equal(2n);
    expect(await decrypt64(await token.balanceOf(merchant.address))).to.equal(price);
    expect(await decrypt64(await token.balanceOf(treasury.address))).to.equal(0n);
  });
});
