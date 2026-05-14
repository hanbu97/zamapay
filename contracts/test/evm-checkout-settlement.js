const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EvmCheckoutSettlement", function () {
  async function deployFixture() {
    const [deployer, buyer, merchant, attacker, feeWallet] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("StandardERC20Mock");
    const token = await Token.deploy("Local USDT", "USDT", 6);
    await token.waitForDeployment();

    const Settlement = await ethers.getContractFactory("EvmCheckoutSettlement");
    const settlement = await Settlement.deploy(deployer.address, feeWallet.address);
    await settlement.waitForDeployment();

    await token.mint(buyer.address, 1_000_000_000);

    return { attacker, buyer, deployer, feeWallet, merchant, settlement, token };
  }

  async function payInput(settlement, token, overrides = {}) {
    const latest = await ethers.provider.getBlock("latest");
    return {
      intentId: overrides.intentId ?? ethers.id(`intent:${Date.now()}:${Math.random()}`),
      projectId: overrides.projectId ?? ethers.id("project:merchant"),
      token: overrides.token ?? (await token.getAddress()),
      grossAmount: overrides.grossAmount ?? 120_000_000n,
      merchantNetAmount: overrides.merchantNetAmount ?? 119_400_000n,
      platformFeeAmount: overrides.platformFeeAmount ?? 600_000n,
      expiresAt: overrides.expiresAt ?? BigInt(latest.timestamp + 3600),
    };
  }

  async function submitPayment(settlement, token, buyer, input) {
    await token.connect(buyer).approve(await settlement.getAddress(), input.grossAmount);
    return settlement
      .connect(buyer)
      .pay(
        input.intentId,
        input.projectId,
        input.token,
        input.grossAmount,
        input.merchantNetAmount,
        input.platformFeeAmount,
        input.expiresAt,
      );
  }

  async function signWithdraw(signer, settlement, chainId, input) {
    return signer.signTypedData(
      {
        chainId,
        name: "ZamaPayEvmCheckoutSettlement",
        verifyingContract: await settlement.getAddress(),
        version: "1",
      },
      {
        EvmWithdraw: [
          { name: "projectId", type: "bytes32" },
          { name: "token", type: "address" },
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "withdrawalId", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      input,
    );
  }

  it("escrows exact ERC20 payment and records merchant/platform balances", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);

    await expect(submitPayment(settlement, token, buyer, input))
      .to.emit(settlement, "EvmPaymentAccepted")
      .withArgs(
        input.intentId,
        input.projectId,
        buyer.address,
        input.token,
        input.grossAmount,
        input.merchantNetAmount,
        input.platformFeeAmount,
      );

    expect(await settlement.merchantBalanceOf(input.projectId, input.token)).to.equal(input.merchantNetAmount);
    expect(await settlement.platformBalanceOf(input.token)).to.equal(input.platformFeeAmount);
    expect(await token.balanceOf(await settlement.getAddress())).to.equal(input.grossAmount);
  });

  it("rejects duplicate, expired, and split-mismatched payments", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    await submitPayment(settlement, token, buyer, input);

    await expect(submitPayment(settlement, token, buyer, input)).to.be.revertedWith("intent paid");

    const expired = await payInput(settlement, token, { intentId: ethers.id("intent:expired"), expiresAt: 1n });
    await expect(submitPayment(settlement, token, buyer, expired)).to.be.revertedWith("intent expired");

    const mismatch = await payInput(settlement, token, {
      intentId: ethers.id("intent:split"),
      merchantNetAmount: 100n,
      platformFeeAmount: 1n,
    });
    await expect(submitPayment(settlement, token, buyer, mismatch)).to.be.revertedWith("split mismatch");
  });

  it("withdraws merchant net with a platform authorization", async function () {
    const { buyer, deployer, merchant, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    await submitPayment(settlement, token, buyer, input);

    const { chainId } = await ethers.provider.getNetwork();
    const withdrawal = {
      amount: input.merchantNetAmount,
      deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
      projectId: input.projectId,
      recipient: merchant.address,
      token: input.token,
      withdrawalId: ethers.id("withdraw:001"),
    };
    const signature = await signWithdraw(deployer, settlement, Number(chainId), withdrawal);

    await expect(
      settlement.withdrawMerchant(
        withdrawal.projectId,
        withdrawal.token,
        withdrawal.recipient,
        withdrawal.amount,
        withdrawal.withdrawalId,
        withdrawal.deadline,
        signature,
      ),
    )
      .to.emit(settlement, "EvmMerchantWithdrawn")
      .withArgs(
        withdrawal.projectId,
        withdrawal.token,
        withdrawal.recipient,
        withdrawal.amount,
        withdrawal.withdrawalId,
      );

    expect(await token.balanceOf(merchant.address)).to.equal(withdrawal.amount);
    expect(await settlement.merchantBalanceOf(input.projectId, input.token)).to.equal(0);
  });

  it("lets the platform fee wallet withdraw accrued fees", async function () {
    const { buyer, feeWallet, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    await submitPayment(settlement, token, buyer, input);

    await expect(settlement.connect(feeWallet).withdrawPlatformFee(input.token, feeWallet.address, input.platformFeeAmount))
      .to.emit(settlement, "EvmPlatformFeeWithdrawn")
      .withArgs(input.token, feeWallet.address, input.platformFeeAmount);

    expect(await settlement.platformBalanceOf(input.token)).to.equal(0);
    expect(await token.balanceOf(feeWallet.address)).to.equal(input.platformFeeAmount);
  });

  it("rejects non-platform fee withdrawal attempts", async function () {
    const { attacker, buyer, feeWallet, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    await submitPayment(settlement, token, buyer, input);

    await expect(
      settlement.connect(attacker).withdrawPlatformFee(input.token, feeWallet.address, input.platformFeeAmount),
    ).to.be.revertedWith("fee wallet only");
  });

  it("rejects unauthorized, replayed, and overdrawn withdrawals", async function () {
    const { attacker, buyer, deployer, merchant, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    await submitPayment(settlement, token, buyer, input);

    const { chainId } = await ethers.provider.getNetwork();
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
    const baseWithdrawal = {
      amount: input.merchantNetAmount,
      deadline,
      projectId: input.projectId,
      recipient: merchant.address,
      token: input.token,
      withdrawalId: ethers.id("withdraw:002"),
    };
    const zeroWithdrawal = { ...baseWithdrawal, withdrawalId: ethers.ZeroHash };
    const zeroSignature = await signWithdraw(deployer, settlement, Number(chainId), zeroWithdrawal);
    await expect(
      settlement.withdrawMerchant(
        zeroWithdrawal.projectId,
        zeroWithdrawal.token,
        zeroWithdrawal.recipient,
        zeroWithdrawal.amount,
        zeroWithdrawal.withdrawalId,
        zeroWithdrawal.deadline,
        zeroSignature,
      ),
    ).to.be.revertedWith("withdrawal required");

    const attackerSignature = await signWithdraw(attacker, settlement, Number(chainId), baseWithdrawal);
    await expect(
      settlement.withdrawMerchant(
        baseWithdrawal.projectId,
        baseWithdrawal.token,
        baseWithdrawal.recipient,
        baseWithdrawal.amount,
        baseWithdrawal.withdrawalId,
        baseWithdrawal.deadline,
        attackerSignature,
      ),
    ).to.be.revertedWith("bad signature");

    const signature = await signWithdraw(deployer, settlement, Number(chainId), baseWithdrawal);
    await settlement.withdrawMerchant(
      baseWithdrawal.projectId,
      baseWithdrawal.token,
      baseWithdrawal.recipient,
      baseWithdrawal.amount,
      baseWithdrawal.withdrawalId,
      baseWithdrawal.deadline,
      signature,
    );
    await expect(
      settlement.withdrawMerchant(
        baseWithdrawal.projectId,
        baseWithdrawal.token,
        baseWithdrawal.recipient,
        baseWithdrawal.amount,
        baseWithdrawal.withdrawalId,
        baseWithdrawal.deadline,
        signature,
      ),
    ).to.be.revertedWith("withdraw used");

    const overdrawn = { ...baseWithdrawal, amount: 1n, withdrawalId: ethers.id("withdraw:003") };
    const overdrawnSignature = await signWithdraw(deployer, settlement, Number(chainId), overdrawn);
    await expect(
      settlement.withdrawMerchant(
        overdrawn.projectId,
        overdrawn.token,
        overdrawn.recipient,
        overdrawn.amount,
        overdrawn.withdrawalId,
        overdrawn.deadline,
        overdrawnSignature,
      ),
    ).to.be.revertedWith("balance too low");
  });
});
