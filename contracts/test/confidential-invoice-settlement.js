const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, fhevm } = require("hardhat");
const { FhevmType } = require("@fhevm/hardhat-plugin");

const FREE_FEE_BPS = 50n;
const GROWTH_FEE_BPS = 25n;
const GROWTH_PRICE_MINOR_UNITS = 99000000n;
const GROWTH_ANNUAL_PRICE_MINOR_UNITS = 990000000n;
const ANNUAL_PERIOD_SECONDS = 365n * 24n * 60n * 60n;

describe("ConfidentialInvoiceSettlement", function () {
  async function deployFixture() {
    const [merchant, buyer, payoutWallet, platformWallet, outsider] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("MerchantRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.connect(merchant).registerMerchant(payoutWallet.address, "Mermer Demo");

    const Token = await ethers.getContractFactory("ConfidentialUSDMock");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Pass = await ethers.getContractFactory("SubscriptionPass");
    const pass = await Pass.deploy();
    await pass.waitForDeployment();

    const SubscriptionRegistry = await ethers.getContractFactory("PrivateSubscriptionRegistry");
    const subscriptionRegistry = await SubscriptionRegistry.deploy(
      await pass.getAddress(),
      await token.getAddress(),
      platformWallet.address,
    );
    await subscriptionRegistry.waitForDeployment();
    await pass.setMinter(await subscriptionRegistry.getAddress());

    const Settlement = await ethers.getContractFactory("ConfidentialInvoiceSettlement");
    const settlement = await Settlement.deploy(
      await registry.getAddress(),
      await subscriptionRegistry.getAddress(),
      await token.getAddress(),
      platformWallet.address,
    );
    await settlement.waitForDeployment();
    await subscriptionRegistry.setSettlement(await settlement.getAddress());

    await fhevm.assertCoprocessorInitialized(token, "ConfidentialUSDMock");
    await fhevm.assertCoprocessorInitialized(subscriptionRegistry, "PrivateSubscriptionRegistry");
    await fhevm.assertCoprocessorInitialized(settlement, "ConfidentialInvoiceSettlement");

    return {
      pass,
      registry,
      settlement,
      subscriptionRegistry,
      token,
      merchant,
      buyer,
      payoutWallet,
      platformWallet,
      outsider,
    };
  }

  function feeFor(amountDue, bps) {
    return (amountDue * bps + 9999n) / 10000n;
  }

  async function decryptBool(handle) {
    const proof = await fhevm.publicDecrypt([handle]);

    return {
      accepted: proof.clearValues[handle],
      abiEncodedClearValues: proof.abiEncodedClearValues,
      decryptionProof: proof.decryptionProof,
    };
  }

  async function decrypt64(handle, contractAddress, signer) {
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
  }

  async function encrypt64(contractAddress, signer, amount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add64(amount);
    return encryptedInput.encrypt();
  }

  async function encryptSubscriptionChange(contractAddress, signer, planCode, paidAmount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add16(planCode);
    encryptedInput.add64(paidAmount);
    return encryptedInput.encrypt();
  }

  async function approveToken(token, tokenAddress, owner, spender, amount) {
    const encryptedApproval = await encrypt64(tokenAddress, owner, amount);
    await token.connect(owner).approve(spender, encryptedApproval.handles[0], encryptedApproval.inputProof);
  }

  async function createInvoice(settlement, merchant, amountDue) {
    const expiresAt = BigInt((await time.latest()) + 3600);
    const tx = await settlement.connect(merchant).createInvoice("order-001", expiresAt, amountDue);
    const receipt = await tx.wait();

    return { tx, receipt };
  }

  async function payAndFinalize(settlement, settlementAddress, buyer, invoiceId, amountDue) {
    const encryptedPayment = await encrypt64(settlementAddress, buyer, amountDue);
    await expect(settlement.connect(buyer).payInvoice(invoiceId, encryptedPayment.handles[0], encryptedPayment.inputProof)).to.emit(
      settlement,
      "InvoicePaymentSubmitted",
    );

    const proof = await decryptBool(await settlement.paymentCheckHandleOf(invoiceId));
    expect(proof.accepted).to.equal(true);

    const finalizeTx = await settlement.finalizePayment(invoiceId, proof.abiEncodedClearValues, proof.decryptionProof);
    const receipt = await finalizeTx.wait();

    return { finalizeTx, receipt };
  }

  function splitEvent(settlement, receipt) {
    for (const log of receipt.logs) {
      try {
        const parsed = settlement.interface.parseLog(log);
        if (parsed?.name === "InvoicePaymentSplit") {
          return {
            invoiceId: parsed.args.invoiceId,
            settledAmountHandle: parsed.args.settledAmountHandle,
            platformFeeAmountHandle: parsed.args.platformFeeAmountHandle,
          };
        }
      } catch {
        continue;
      }
    }

    throw new Error("InvoicePaymentSplit event not found");
  }

  async function upgradeToGrowth({ subscriptionRegistry, token, merchant, platformWallet }) {
    const tokenAddress = await token.getAddress();
    const subscriptionRegistryAddress = await subscriptionRegistry.getAddress();

    await subscriptionRegistry.connect(merchant).ensureMerchantPass(merchant.address);
    const passId = await subscriptionRegistry.passOfMerchant(merchant.address);

    await token.mint(merchant.address, GROWTH_PRICE_MINOR_UNITS);
    await approveToken(token, tokenAddress, merchant, subscriptionRegistryAddress, GROWTH_PRICE_MINOR_UNITS);

    const encryptedUpgrade = await encryptSubscriptionChange(subscriptionRegistryAddress, merchant, 2n, GROWTH_PRICE_MINOR_UNITS);
    await expect(
      subscriptionRegistry
        .connect(merchant)
        .requestSubscriptionChange(passId, encryptedUpgrade.handles[0], encryptedUpgrade.handles[1], encryptedUpgrade.inputProof),
    ).to.emit(subscriptionRegistry, "SubscriptionChangeRequested");

    const proof = await decryptBool(await subscriptionRegistry.subscriptionCheckHandleOf(passId));
    expect(proof.accepted).to.equal(true);
    await expect(
      subscriptionRegistry.finalizeSubscriptionChange(passId, proof.abiEncodedClearValues, proof.decryptionProof),
    )
      .to.emit(subscriptionRegistry, "SubscriptionChangeFinalized")
      .withArgs(passId, merchant.address, true, 2n);

    expect(await decrypt64(await token.balanceOf(platformWallet.address), tokenAddress, platformWallet)).to.equal(
      GROWTH_PRICE_MINOR_UNITS,
    );

    return passId;
  }

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("settles a default free-plan invoice without exposing the fee bps or split amounts", async function () {
    const { pass, settlement, subscriptionRegistry, token, merchant, buyer, payoutWallet, platformWallet, outsider } =
      await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 2500000n;
    const platformFee = feeFor(amountDue, FREE_FEE_BPS);
    const merchantNetAmount = amountDue - platformFee;

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);

    await expect(settlement.connect(merchant).createInvoice("order-free", BigInt((await time.latest()) + 3600), amountDue)).to.emit(
      settlement,
      "InvoiceCreated",
    );

    const passId = await subscriptionRegistry.passOfMerchant(merchant.address);
    expect(await pass.ownerOf(passId)).to.equal(merchant.address);

    const { receipt } = await payAndFinalize(settlement, settlementAddress, buyer, 0, amountDue);
    const split = splitEvent(settlement, receipt);
    expect(split.invoiceId).to.equal(0n);
    expect(split.settledAmountHandle).to.not.equal(ethers.ZeroHash);
    expect(split.platformFeeAmountHandle).to.not.equal(ethers.ZeroHash);

    const invoice = await settlement.invoices(0);
    expect(invoice.amountDue).to.equal(amountDue);
    expect(invoice.subscriptionTermsVersion).to.equal(1n);
    expect(invoice.paymentTruth).to.equal(3n);
    expect(invoice.payer).to.equal(buyer.address);

    const handle = await settlement.settledAmountOf(0);
    expect(await decrypt64(handle, settlementAddress, merchant)).to.equal(merchantNetAmount);
    expect(await decrypt64(handle, settlementAddress, payoutWallet)).to.equal(merchantNetAmount);
    await expect(decrypt64(handle, settlementAddress, outsider)).to.be.rejectedWith("not authorized");

    const feeHandle = await settlement.platformFeeAmountOf(0);
    expect(await decrypt64(feeHandle, settlementAddress, platformWallet)).to.equal(platformFee);
    await expect(decrypt64(feeHandle, settlementAddress, merchant)).to.be.rejectedWith("not authorized");

    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(merchantNetAmount);
    expect(await decrypt64(await token.balanceOf(platformWallet.address), tokenAddress, platformWallet)).to.equal(platformFee);
    expect(await decrypt64(await token.balanceOf(buyer.address), tokenAddress, buyer)).to.equal(0n);
  });

  it("applies a privately upgraded growth entitlement to new invoices", async function () {
    const { settlement, subscriptionRegistry, token, merchant, buyer, payoutWallet, platformWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 120000000n;
    const platformFee = feeFor(amountDue, GROWTH_FEE_BPS);
    const merchantNetAmount = amountDue - platformFee;

    await upgradeToGrowth({ subscriptionRegistry, token, merchant, platformWallet });
    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);
    await createInvoice(settlement, merchant, amountDue);

    const invoice = await settlement.invoices(0);
    expect(invoice.subscriptionTermsVersion).to.equal(2n);

    await payAndFinalize(settlement, settlementAddress, buyer, 0, amountDue);
    expect(await decrypt64(await settlement.platformFeeAmountOf(0), settlementAddress, platformWallet)).to.equal(platformFee);
    expect(await decrypt64(await settlement.settledAmountOf(0), settlementAddress, payoutWallet)).to.equal(merchantNetAmount);
    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(merchantNetAmount);
  });

  it("keeps the invoice fee snapshot when growth is bought after invoice creation", async function () {
    const { settlement, subscriptionRegistry, token, merchant, buyer, payoutWallet, platformWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 120000000n;
    const platformFee = feeFor(amountDue, FREE_FEE_BPS);
    const merchantNetAmount = amountDue - platformFee;

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);
    await createInvoice(settlement, merchant, amountDue);

    const invoiceBeforePayment = await settlement.invoices(0);
    expect(invoiceBeforePayment.subscriptionTermsVersion).to.equal(1n);

    await upgradeToGrowth({ subscriptionRegistry, token, merchant, platformWallet });
    await payAndFinalize(settlement, settlementAddress, buyer, 0, amountDue);

    expect(await decrypt64(await settlement.platformFeeAmountOf(0), settlementAddress, platformWallet)).to.equal(platformFee);
    expect(await decrypt64(await settlement.settledAmountOf(0), settlementAddress, payoutWallet)).to.equal(merchantNetAmount);
  });

  it("keeps the default fee when a private growth upgrade is underpaid", async function () {
    const { settlement, subscriptionRegistry, token, merchant, buyer, payoutWallet, platformWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 120000000n;
    const platformFee = feeFor(amountDue, FREE_FEE_BPS);
    const merchantNetAmount = amountDue - platformFee;
    const subscriptionRegistryAddress = await subscriptionRegistry.getAddress();

    await subscriptionRegistry.connect(merchant).ensureMerchantPass(merchant.address);
    const passId = await subscriptionRegistry.passOfMerchant(merchant.address);

    await token.mint(merchant.address, 1n);
    await approveToken(token, tokenAddress, merchant, subscriptionRegistryAddress, 1n);

    const encryptedUpgrade = await encryptSubscriptionChange(subscriptionRegistryAddress, merchant, 2n, 1n);
    await subscriptionRegistry
      .connect(merchant)
      .requestSubscriptionChange(passId, encryptedUpgrade.handles[0], encryptedUpgrade.handles[1], encryptedUpgrade.inputProof);

    const proof = await decryptBool(await subscriptionRegistry.subscriptionCheckHandleOf(passId));
    expect(proof.accepted).to.equal(false);
    await subscriptionRegistry.finalizeSubscriptionChange(passId, proof.abiEncodedClearValues, proof.decryptionProof);

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);
    await createInvoice(settlement, merchant, amountDue);
    await payAndFinalize(settlement, settlementAddress, buyer, 0, amountDue);

    expect(await decrypt64(await settlement.platformFeeAmountOf(0), settlementAddress, platformWallet)).to.equal(platformFee);
    expect(await decrypt64(await settlement.settledAmountOf(0), settlementAddress, payoutWallet)).to.equal(merchantNetAmount);
  });

  it("accepts an annual private growth subscription payment", async function () {
    const { subscriptionRegistry, token, merchant, platformWallet } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const subscriptionRegistryAddress = await subscriptionRegistry.getAddress();

    await subscriptionRegistry.connect(merchant).ensureMerchantPass(merchant.address);
    const passId = await subscriptionRegistry.passOfMerchant(merchant.address);

    await token.mint(merchant.address, GROWTH_ANNUAL_PRICE_MINOR_UNITS);
    await approveToken(token, tokenAddress, merchant, subscriptionRegistryAddress, GROWTH_ANNUAL_PRICE_MINOR_UNITS);

    const encryptedUpgrade = await encryptSubscriptionChange(
      subscriptionRegistryAddress,
      merchant,
      2n,
      GROWTH_ANNUAL_PRICE_MINOR_UNITS,
    );
    const requestTx = await subscriptionRegistry
      .connect(merchant)
      .requestSubscriptionChange(passId, encryptedUpgrade.handles[0], encryptedUpgrade.handles[1], encryptedUpgrade.inputProof);
    const receipt = await requestTx.wait();

    const proof = await decryptBool(await subscriptionRegistry.subscriptionCheckHandleOf(passId));
    expect(proof.accepted).to.equal(true);
    await subscriptionRegistry.finalizeSubscriptionChange(passId, proof.abiEncodedClearValues, proof.decryptionProof);

    const requestBlock = await ethers.provider.getBlock(receipt.blockNumber);
    const validUntil = await decrypt64(await subscriptionRegistry.validUntilOf(passId), subscriptionRegistryAddress, merchant);
    expect(validUntil).to.equal(BigInt(requestBlock.timestamp) + ANNUAL_PERIOD_SECONDS);
    expect(await decrypt64(await token.balanceOf(platformWallet.address), tokenAddress, platformWallet)).to.equal(
      GROWTH_ANNUAL_PRICE_MINOR_UNITS,
    );
  });

  it("rejects underpayment after FHE public proof and leaves the invoice retryable", async function () {
    const { settlement, token, merchant, buyer, payoutWallet, platformWallet } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 2500000n;
    const platformFee = feeFor(amountDue, FREE_FEE_BPS);
    const merchantNetAmount = amountDue - platformFee;

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);
    await createInvoice(settlement, merchant, amountDue);

    const underpayment = await encrypt64(settlementAddress, buyer, 1000000n);
    await settlement.connect(buyer).payInvoice(0, underpayment.handles[0], underpayment.inputProof);

    const rejectedProof = await decryptBool(await settlement.paymentCheckHandleOf(0));
    expect(rejectedProof.accepted).to.equal(false);
    await expect(
      settlement.finalizePayment(0, rejectedProof.abiEncodedClearValues, rejectedProof.decryptionProof),
    ).to.emit(settlement, "InvoicePaymentRejected");

    let invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(1n);
    expect(invoice.payer).to.equal(ethers.ZeroAddress);
    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(0n);
    expect(await decrypt64(await token.balanceOf(platformWallet.address), tokenAddress, platformWallet)).to.equal(0n);

    const exactPayment = await encrypt64(settlementAddress, buyer, amountDue);
    await settlement.connect(buyer).payInvoice(0, exactPayment.handles[0], exactPayment.inputProof);
    const acceptedProof = await decryptBool(await settlement.paymentCheckHandleOf(0));
    expect(acceptedProof.accepted).to.equal(true);
    await settlement.finalizePayment(0, acceptedProof.abiEncodedClearValues, acceptedProof.decryptionProof);

    invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(3n);
    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(merchantNetAmount);
    expect(await decrypt64(await token.balanceOf(platformWallet.address), tokenAddress, platformWallet)).to.equal(platformFee);
  });

  it("rejects duplicate payment once an invoice is already paid", async function () {
    const { settlement, token, merchant, buyer } = await deployFixture();
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 500000n;

    await token.mint(buyer.address, amountDue * 2n);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue * 2n);
    await createInvoice(settlement, merchant, amountDue);

    const encryptedPayment = await encrypt64(settlementAddress, buyer, amountDue);

    await settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof);
    const proof = await decryptBool(await settlement.paymentCheckHandleOf(0));
    await settlement.finalizePayment(0, proof.abiEncodedClearValues, proof.decryptionProof);

    await expect(
      settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof),
    ).to.be.revertedWith("invoice not payable");
  });

  it("rejects late payment and lets the merchant explicitly expire the invoice", async function () {
    const { settlement, merchant, buyer } = await deployFixture();
    const expiresAt = BigInt((await time.latest()) + 5);
    const settlementAddress = await settlement.getAddress();

    await settlement.connect(merchant).createInvoice("order-003", expiresAt, 100000n);
    await time.increaseTo(Number(expiresAt) + 1);

    const encryptedPayment = await encrypt64(settlementAddress, buyer, 100000n);

    await expect(
      settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof),
    ).to.be.revertedWith("invoice expired");

    await expect(settlement.connect(merchant).expireInvoice(0)).to.emit(settlement, "InvoiceExpired");

    const invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(4n);
  });

  it("rejects zero-amount invoices", async function () {
    const { settlement, merchant } = await deployFixture();
    const expiresAt = BigInt((await time.latest()) + 3600);

    await expect(settlement.connect(merchant).createInvoice("order-zero", expiresAt, 0n)).to.be.revertedWith(
      "amount due required",
    );
  });
});
