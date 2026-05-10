const { expect } = require("chai");
const { ethers, fhevm } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("PrivateCheckoutSettlement", function () {
  async function deployFixture() {
    const [creator, buyer, merchant, payoutWallet] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ConfidentialUSDMock");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Settlement = await ethers.getContractFactory("PrivateCheckoutSettlement");
    const settlement = await Settlement.deploy(await token.getAddress());
    await settlement.waitForDeployment();
    await token.setSettlement(await settlement.getAddress());

    await fhevm.assertCoprocessorInitialized(token, "ConfidentialUSDMock");
    await fhevm.assertCoprocessorInitialized(settlement, "PrivateCheckoutSettlement");

    return { token, settlement, creator, buyer, merchant, payoutWallet };
  }

  async function encrypt64(contractAddress, signer, amount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add64(amount);
    return encryptedInput.encrypt();
  }

  async function encryptCheckoutAmounts(contractAddress, signer, grossAmount, merchantNetAmount, platformFeeAmount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add64(grossAmount);
    encryptedInput.add64(merchantNetAmount);
    encryptedInput.add64(platformFeeAmount);
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

  async function mintToken(token, account, amount) {
    await token.mint(account.address, amount);
  }

  function ownerCommitment(bucketCommitment, account) {
    return ethers.solidityPackedKeccak256(["bytes32", "address"], [bucketCommitment, account.address]);
  }

  async function createCheckout(input) {
    const {
      settlement,
      settlementAddress,
      creator,
      orderCommitment,
      bucketCommitment,
      bucketOwner,
      grossAmount,
      merchantNetAmount,
      platformFeeAmount,
    } = input;
    const encrypted = await encryptCheckoutAmounts(
      settlementAddress,
      creator,
      grossAmount,
      merchantNetAmount,
      platformFeeAmount,
    );
    const expiresAt = BigInt((await time.latest()) + 3600);

    await expect(
      settlement
        .connect(creator)
        .createPrivateCheckout(
          orderCommitment,
          bucketCommitment,
      ownerCommitment(bucketCommitment, bucketOwner),
          encrypted.handles[0],
          encrypted.handles[1],
          encrypted.handles[2],
          encrypted.inputProof,
          expiresAt,
        ),
    ).to.emit(settlement, "PrivateCheckoutCreated");
  }

  async function submitPayment(settlement, settlementAddress, buyer, orderCommitment, nonce, amount) {
    const encrypted = await encrypt64(settlementAddress, buyer, amount);
    const tx = await settlement
      .connect(buyer)
      .submitPrivatePayment(orderCommitment, nonce, encrypted.handles[0], encrypted.inputProof);
    return tx.wait();
  }

  async function signWithdrawAuthorization(input) {
    const {
      settlementAddress,
      bucketCommitment,
      withdrawalNonce,
      bucketOwner,
      recipient,
      encryptedAmount,
      inputProof,
      deadline,
    } = input;
    const network = await ethers.provider.getNetwork();

    return bucketOwner.signTypedData(
      {
        name: "ZamaPayPrivateCheckoutSettlement",
        version: "1",
        chainId: network.chainId,
        verifyingContract: settlementAddress,
      },
      {
        PrivateWithdraw: [
          { name: "settlementBucketCommitment", type: "bytes32" },
          { name: "withdrawalNonce", type: "bytes32" },
          { name: "bucketOwner", type: "address" },
          { name: "recipient", type: "address" },
          { name: "encryptedAmount", type: "bytes32" },
          { name: "inputProofHash", type: "bytes32" },
          { name: "deadline", type: "uint64" },
        ],
      },
      {
        settlementBucketCommitment: bucketCommitment,
        withdrawalNonce,
        bucketOwner: bucketOwner.address,
        recipient: recipient.address,
        encryptedAmount: encryptedAmount.handles[0],
        inputProofHash: ethers.keccak256(inputProof),
        deadline,
      },
    );
  }

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("finalizes a private checkout and credits encrypted merchant pending", async function () {
    const { token, settlement, creator, buyer, merchant, payoutWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const amount = 120000000n;
    const platformFee = 600000n;
    const merchantNet = amount - platformFee;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:001"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:001"));

    await mintToken(token, buyer, amount);
    await createCheckout({
      settlement,
      settlementAddress,
      creator,
      orderCommitment,
      bucketCommitment,
      bucketOwner: merchant,
      grossAmount: amount,
      merchantNetAmount: merchantNet,
      platformFeeAmount: platformFee,
    });
    const receipt = await submitPayment(settlement, settlementAddress, buyer, orderCommitment, nonce, amount);

    const proof = await decryptBool(await settlement.paymentCheckHandleOf(orderCommitment));
    expect(proof.accepted).to.equal(true);
    expect(await decrypt64(await settlement.merchantPendingHandleOf(bucketCommitment))).to.equal(merchantNet);
    expect(await decrypt64(await settlement.platformPendingHandleOf(bucketCommitment))).to.equal(platformFee);

    await expect(
      settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof),
    ).to.emit(settlement, "PrivatePaymentFinalized");

    expect(await settlement.statusOf(orderCommitment)).to.equal(3n);
    expect(await decrypt64(await token.balanceOf(buyer.address))).to.equal(0n);
    expect(await decrypt64(await token.balanceOf(settlementAddress))).to.equal(amount);

    const emittedText = JSON.stringify(receipt.logs);
    expect(emittedText).to.not.include(merchant.address.slice(2).toLowerCase());
    expect(emittedText).to.not.include(payoutWallet.address.slice(2).toLowerCase());
    expect(emittedText).to.not.include(amount.toString(16));
  });

  it("rejects wrong encrypted amounts and blocks replay/finalize abuse", async function () {
    const { token, settlement, creator, buyer } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const expectedAmount = 120000000n;
    const paidAmount = 119000000n;
    const platformFee = 600000n;
    const merchantNet = expectedAmount - platformFee;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:002"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:002"));

    await mintToken(token, buyer, expectedAmount);
    await createCheckout({
      settlement,
      settlementAddress,
      creator,
      orderCommitment,
      bucketCommitment,
      bucketOwner: creator,
      grossAmount: expectedAmount,
      merchantNetAmount: merchantNet,
      platformFeeAmount: platformFee,
    });
    await submitPayment(settlement, settlementAddress, buyer, orderCommitment, nonce, paidAmount);

    await expect(
      submitPayment(settlement, settlementAddress, buyer, orderCommitment, nonce, paidAmount),
    ).to.be.rejectedWith("checkout not payable");

    const proof = await decryptBool(await settlement.paymentCheckHandleOf(orderCommitment));
    expect(proof.accepted).to.equal(false);
    expect(await decrypt64(await settlement.merchantPendingHandleOf(bucketCommitment))).to.equal(0n);

    await settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof);
    expect(await settlement.statusOf(orderCommitment)).to.equal(4n);
    await expect(
      settlement.finalizePrivatePayment(orderCommitment, proof.abiEncodedClearValues, proof.decryptionProof),
    ).to.be.revertedWith("checkout not submitted");
  });

  it("does not accept expired checkouts", async function () {
    const { token, settlement, creator, buyer } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const amount = 120000000n;
    const platformFee = 600000n;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:003"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:daily"));
    const nonce = ethers.keccak256(ethers.toUtf8Bytes("payment:003"));
    const encrypted = await encryptCheckoutAmounts(settlementAddress, creator, amount, amount - platformFee, platformFee);
    const expiresAt = BigInt((await time.latest()) + 10);

    await mintToken(token, buyer, amount);
    await settlement
      .connect(creator)
      .createPrivateCheckout(
        orderCommitment,
        bucketCommitment,
        ownerCommitment(bucketCommitment, creator),
        encrypted.handles[0],
        encrypted.handles[1],
        encrypted.handles[2],
        encrypted.inputProof,
        expiresAt,
      );
    await time.increaseTo(Number(expiresAt) + 1);

    const payment = await encrypt64(settlementAddress, buyer, amount);
    await expect(
      settlement
        .connect(buyer)
        .submitPrivatePayment(orderCommitment, nonce, payment.handles[0], payment.inputProof),
    ).to.be.revertedWith("checkout expired");
  });

  it("withdraws encrypted merchant pending balance with a bucket-owner authorization", async function () {
    const { token, settlement, creator, buyer, merchant, payoutWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const amount = 120000000n;
    const platformFee = 600000n;
    const merchantNet = amount - platformFee;
    const orderCommitment = ethers.keccak256(ethers.toUtf8Bytes("order:cardforge:004"));
    const bucketCommitment = ethers.keccak256(ethers.toUtf8Bytes("bucket:merchant:growth"));
    const paymentNonce = ethers.keccak256(ethers.toUtf8Bytes("payment:004"));
    const withdrawalNonce = ethers.keccak256(ethers.toUtf8Bytes("withdraw:004"));

    await mintToken(token, buyer, amount);
    await createCheckout({
      settlement,
      settlementAddress,
      creator,
      orderCommitment,
      bucketCommitment,
      bucketOwner: merchant,
      grossAmount: amount,
      merchantNetAmount: merchantNet,
      platformFeeAmount: platformFee,
    });
    await submitPayment(settlement, settlementAddress, buyer, orderCommitment, paymentNonce, amount);

    expect(await decrypt64(await settlement.merchantPendingHandleOf(bucketCommitment))).to.equal(merchantNet);
    expect(await decrypt64(await token.balanceOf(settlementAddress))).to.equal(amount);

    const withdrawAmount = await encrypt64(settlementAddress, creator, merchantNet);
    const deadline = BigInt((await time.latest()) + 3600);
    const authorization = await signWithdrawAuthorization({
      settlementAddress,
      bucketCommitment,
      withdrawalNonce,
      bucketOwner: merchant,
      recipient: merchant,
      encryptedAmount: withdrawAmount,
      inputProof: withdrawAmount.inputProof,
      deadline,
    });
    await expect(
      settlement
        .connect(creator)
        .requestPrivateWithdraw(
          bucketCommitment,
          withdrawalNonce,
          merchant.address,
          merchant.address,
          withdrawAmount.handles[0],
          withdrawAmount.inputProof,
          deadline,
          authorization,
        ),
    ).to.emit(settlement, "PrivateWithdrawSubmitted");

    const proof = await decryptBool(await settlement.withdrawalCheckHandleOf(withdrawalNonce));
    expect(proof.accepted).to.equal(true);
    expect(await decrypt64(await settlement.merchantPendingHandleOf(bucketCommitment))).to.equal(0n);
    expect(await decrypt64(await token.balanceOf(merchant.address))).to.equal(merchantNet);
    expect(await decrypt64(await token.balanceOf(settlementAddress))).to.equal(platformFee);

    const attackerWithdraw = await encrypt64(settlementAddress, creator, 1n);
    const attackerNonce = ethers.keccak256(ethers.toUtf8Bytes("withdraw:attacker"));
    const attackerDeadline = BigInt((await time.latest()) + 3600);
    const attackerAuthorization = await signWithdrawAuthorization({
      settlementAddress,
      bucketCommitment,
      withdrawalNonce: attackerNonce,
      bucketOwner: payoutWallet,
      recipient: payoutWallet,
      encryptedAmount: attackerWithdraw,
      inputProof: attackerWithdraw.inputProof,
      deadline: attackerDeadline,
    });
    await expect(
      settlement
        .connect(creator)
        .requestPrivateWithdraw(
          bucketCommitment,
          attackerNonce,
          payoutWallet.address,
          payoutWallet.address,
          attackerWithdraw.handles[0],
          attackerWithdraw.inputProof,
          attackerDeadline,
          attackerAuthorization,
        ),
    ).to.be.revertedWith("bucket owner only");
  });
});
