const { expect } = require("chai");
const { ethers, fhevm } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("PrivateCheckoutSettlement", function () {
  async function deployFixture() {
    const [relayer, buyer, merchant, payoutWallet] = await ethers.getSigners();

    const Rail = await ethers.getContractFactory("MockConfidentialPaymentRail");
    const rail = await Rail.deploy();
    await rail.waitForDeployment();

    const Settlement = await ethers.getContractFactory("PrivateCheckoutSettlement");
    const settlement = await Settlement.deploy(await rail.getAddress(), relayer.address);
    await settlement.waitForDeployment();
    await rail.setSettlement(await settlement.getAddress());

    await fhevm.assertCoprocessorInitialized(rail, "MockConfidentialPaymentRail");
    await fhevm.assertCoprocessorInitialized(settlement, "PrivateCheckoutSettlement");

    return { rail, settlement, relayer, buyer, merchant, payoutWallet };
  }

  async function encrypt64(contractAddress, signer, amount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add64(amount);
    return encryptedInput.encrypt();
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

  async function fundRail(rail, railAddress, relayer, accountCommitment, amount) {
    const encrypted = await encrypt64(railAddress, relayer, amount);
    await rail.fund(accountCommitment, encrypted.handles[0], encrypted.inputProof);
  }

  async function createCheckout(settlement, settlementAddress, relayer, orderCommitment, bucketCommitment, amount) {
    const encrypted = await encrypt64(settlementAddress, relayer, amount);
    const expiresAt = BigInt((await time.latest()) + 3600);
    await expect(
      settlement
        .connect(relayer)
        .createPrivateCheckout(orderCommitment, bucketCommitment, encrypted.handles[0], encrypted.inputProof, expiresAt),
    ).to.emit(settlement, "PrivateCheckoutCreated");
  }

  async function submitPayment(settlement, settlementAddress, relayer, orderCommitment, accountCommitment, nonce, amount) {
    const encrypted = await encrypt64(settlementAddress, relayer, amount);
    const tx = await settlement
      .connect(relayer)
      .submitPrivatePayment(orderCommitment, accountCommitment, nonce, encrypted.handles[0], encrypted.inputProof);
    return tx.wait();
  }

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("finalizes a private checkout without emitting buyer, merchant, payout wallet, or amount", async function () {
    const { rail, settlement, relayer, buyer, merchant, payoutWallet } = await deployFixture();
    const railAddress = await rail.getAddress();
    const settlementAddress = await settlement.getAddress();
    const amount = 120000000n;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:001"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const accountCommitment = ethers.keccak256(ethers.toUtf8Bytes(`buyer:${buyer.address}`));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:001"));

    await fundRail(rail, railAddress, relayer, accountCommitment, amount);
    await createCheckout(settlement, settlementAddress, relayer, orderCommitment, bucketCommitment, amount);
    const receipt = await submitPayment(
      settlement,
      settlementAddress,
      relayer,
      orderCommitment,
      accountCommitment,
      nonce,
      amount,
    );

    const handle = await settlement.paymentCheckHandleOf(orderCommitment);
    const proof = await decryptBool(handle);
    expect(proof.accepted).to.equal(true);

    await expect(
      settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof),
    ).to.emit(settlement, "PrivatePaymentFinalized");

    expect(await settlement.statusOf(orderCommitment)).to.equal(3n);
    expect(await decrypt64(await rail.balanceHandleOf(accountCommitment))).to.equal(0n);

    const emittedText = JSON.stringify(receipt.logs);
    expect(emittedText).to.not.include(buyer.address.slice(2).toLowerCase());
    expect(emittedText).to.not.include(merchant.address.slice(2).toLowerCase());
    expect(emittedText).to.not.include(payoutWallet.address.slice(2).toLowerCase());
    expect(emittedText).to.not.include(amount.toString(16));
  });

  it("rejects wrong encrypted amounts and blocks replay/finalize abuse", async function () {
    const { rail, settlement, relayer, buyer } = await deployFixture();
    const railAddress = await rail.getAddress();
    const settlementAddress = await settlement.getAddress();
    const expectedAmount = 120000000n;
    const paidAmount = 119000000n;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:002"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const accountCommitment = ethers.keccak256(ethers.toUtf8Bytes(`buyer:${buyer.address}`));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:002"));

    await fundRail(rail, railAddress, relayer, accountCommitment, expectedAmount);
    await createCheckout(settlement, settlementAddress, relayer, orderCommitment, bucketCommitment, expectedAmount);
    await submitPayment(settlement, settlementAddress, relayer, orderCommitment, accountCommitment, nonce, paidAmount);

    await expect(
      submitPayment(settlement, settlementAddress, relayer, orderCommitment, accountCommitment, nonce, paidAmount),
    ).to.be.rejectedWith("checkout not payable");

    const proof = await decryptBool(await settlement.paymentCheckHandleOf(orderCommitment));
    expect(proof.accepted).to.equal(false);

    await settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof);
    expect(await settlement.statusOf(orderCommitment)).to.equal(4n);
    await expect(
      settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof),
    ).to.be.revertedWith("checkout not submitted");
  });

  it("does not accept expired checkouts", async function () {
    const { rail, settlement, relayer, buyer } = await deployFixture();
    const railAddress = await rail.getAddress();
    const settlementAddress = await settlement.getAddress();
    const amount = 120000000n;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:003"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const accountCommitment = ethers.keccak256(ethers.toUtf8Bytes(`buyer:${buyer.address}`));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:003"));
    const encrypted = await encrypt64(settlementAddress, relayer, amount);
    const expiresAt = BigInt((await time.latest()) + 10);

    await fundRail(rail, railAddress, relayer, accountCommitment, amount);
    await settlement
      .connect(relayer)
      .createPrivateCheckout(orderCommitment, bucketCommitment, encrypted.handles[0], encrypted.inputProof, expiresAt);
    await time.increaseTo(Number(expiresAt) + 1);

    const payment = await encrypt64(settlementAddress, relayer, amount);
    await expect(
      settlement
        .connect(relayer)
        .submitPrivatePayment(orderCommitment, accountCommitment, nonce, payment.handles[0], payment.inputProof),
    ).to.be.revertedWith("checkout expired");
  });
});
