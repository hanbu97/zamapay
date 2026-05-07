const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, fhevm } = require("hardhat");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("ConfidentialInvoiceSettlement", function () {
  async function deployFixture() {
    const [merchant, buyer, payoutWallet, outsider] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("MerchantRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    await registry.connect(merchant).registerMerchant(payoutWallet.address, "Mermer Demo");

    const Token = await ethers.getContractFactory("ConfidentialUSDMock");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Settlement = await ethers.getContractFactory("ConfidentialInvoiceSettlement");
    const settlement = await Settlement.deploy(await registry.getAddress(), await token.getAddress());
    await settlement.waitForDeployment();

    await fhevm.assertCoprocessorInitialized(token, "ConfidentialUSDMock");
    await fhevm.assertCoprocessorInitialized(settlement, "ConfidentialInvoiceSettlement");

    return { settlement, token, merchant, buyer, payoutWallet, outsider };
  }

  async function decrypt64(handle, contractAddress, signer) {
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
  }

  async function encrypt64(contractAddress, signer, amount) {
    const encryptedInput = fhevm.createEncryptedInput(contractAddress, signer.address);
    encryptedInput.add64(amount);
    return encryptedInput.encrypt();
  }

  async function approveToken(token, tokenAddress, owner, spender, amount) {
    const encryptedApproval = await encrypt64(tokenAddress, owner, amount);
    await token.connect(owner).approve(spender, encryptedApproval.handles[0], encryptedApproval.inputProof);
  }

  async function paymentProof(settlement, invoiceId) {
    const handle = await settlement.paymentCheckHandleOf(invoiceId);
    const proof = await fhevm.publicDecrypt([handle]);

    return {
      accepted: proof.clearValues[handle],
      abiEncodedClearValues: proof.abiEncodedClearValues,
      decryptionProof: proof.decryptionProof,
    };
  }

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("creates an invoice, verifies exact encrypted payment, and moves confidential token balance", async function () {
    const { settlement, token, merchant, buyer, payoutWallet, outsider } = await deployFixture();
    const expiresAt = BigInt((await time.latest()) + 3600);
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 2500000n;

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);

    await expect(settlement.connect(merchant).createInvoice("order-001", expiresAt, amountDue)).to.emit(
      settlement,
      "InvoiceCreated",
    );

    const encryptedPayment = await encrypt64(settlementAddress, buyer, amountDue);
    await expect(settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof)).to.emit(
      settlement,
      "InvoicePaymentSubmitted",
    );

    let invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(2n);
    expect(invoice.payer).to.equal(buyer.address);

    const proof = await paymentProof(settlement, 0);
    expect(proof.accepted).to.equal(true);
    await expect(settlement.finalizePayment(0, proof.abiEncodedClearValues, proof.decryptionProof)).to.emit(
      settlement,
      "InvoicePaid",
    );

    invoice = await settlement.invoices(0);
    expect(invoice.amountDue).to.equal(amountDue);
    expect(invoice.paymentTruth).to.equal(3n);
    expect(invoice.payer).to.equal(buyer.address);

    const handle = await settlement.settledAmountOf(0);
    expect(await decrypt64(handle, settlementAddress, merchant)).to.equal(amountDue);
    expect(await decrypt64(handle, settlementAddress, payoutWallet)).to.equal(amountDue);
    await expect(decrypt64(handle, settlementAddress, outsider)).to.be.rejectedWith("not authorized");

    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(amountDue);
    expect(await decrypt64(await token.balanceOf(buyer.address), tokenAddress, buyer)).to.equal(0n);
  });

  it("rejects underpayment after FHE public proof and leaves the invoice retryable", async function () {
    const { settlement, token, merchant, buyer, payoutWallet } = await deployFixture();
    const expiresAt = BigInt((await time.latest()) + 3600);
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 2500000n;

    await token.mint(buyer.address, amountDue);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue);
    await settlement.connect(merchant).createInvoice("order-underpay", expiresAt, amountDue);

    const underpayment = await encrypt64(settlementAddress, buyer, 1000000n);
    await settlement.connect(buyer).payInvoice(0, underpayment.handles[0], underpayment.inputProof);

    const rejectedProof = await paymentProof(settlement, 0);
    expect(rejectedProof.accepted).to.equal(false);
    await expect(
      settlement.finalizePayment(0, rejectedProof.abiEncodedClearValues, rejectedProof.decryptionProof),
    ).to.emit(settlement, "InvoicePaymentRejected");

    let invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(1n);
    expect(invoice.payer).to.equal(ethers.ZeroAddress);
    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(0n);

    const exactPayment = await encrypt64(settlementAddress, buyer, amountDue);
    await settlement.connect(buyer).payInvoice(0, exactPayment.handles[0], exactPayment.inputProof);
    const acceptedProof = await paymentProof(settlement, 0);
    expect(acceptedProof.accepted).to.equal(true);
    await settlement.finalizePayment(0, acceptedProof.abiEncodedClearValues, acceptedProof.decryptionProof);

    invoice = await settlement.invoices(0);
    expect(invoice.paymentTruth).to.equal(3n);
    expect(await decrypt64(await token.balanceOf(payoutWallet.address), tokenAddress, payoutWallet)).to.equal(amountDue);
  });

  it("rejects duplicate payment once an invoice is already paid", async function () {
    const { settlement, token, merchant, buyer } = await deployFixture();
    const expiresAt = BigInt((await time.latest()) + 3600);
    const settlementAddress = await settlement.getAddress();
    const tokenAddress = await token.getAddress();
    const amountDue = 500000n;

    await token.mint(buyer.address, amountDue * 2n);
    await approveToken(token, tokenAddress, buyer, settlementAddress, amountDue * 2n);
    await settlement.connect(merchant).createInvoice("order-002", expiresAt, amountDue);

    const encryptedPayment = await encrypt64(settlementAddress, buyer, amountDue);

    await settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof);
    const proof = await paymentProof(settlement, 0);
    await settlement.finalizePayment(0, proof.abiEncodedClearValues, proof.decryptionProof);

    await expect(
      settlement.connect(buyer).payInvoice(0, encryptedPayment.handles[0], encryptedPayment.inputProof),
    ).to.be.revertedWith("invoice not payable");
  });

  it("rejects late payment and lets the merchant explicitly expire the invoice", async function () {
    const { settlement, token, merchant, buyer } = await deployFixture();
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
});
