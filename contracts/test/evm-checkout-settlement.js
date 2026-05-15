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

  async function deployFixtureWithToken(factoryName, name = "Local USDT") {
    const [deployer, buyer, merchant, attacker, feeWallet] = await ethers.getSigners();
    const Token = await ethers.getContractFactory(factoryName);
    const token = await Token.deploy(name, "USDT", 6);
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

  async function balances(settlement, token, input) {
    return {
      merchant: await settlement.merchantBalanceOf(input.projectId, input.token),
      platform: await settlement.platformBalanceOf(input.token),
      settlementToken: await token.balanceOf(await settlement.getAddress()),
    };
  }

  async function expectPaymentBalances(settlement, token, input) {
    expect(await settlement.acceptedIntent(input.intentId)).to.equal(true);
    expect(await settlement.merchantBalanceOf(input.projectId, input.token)).to.equal(input.merchantNetAmount);
    expect(await settlement.platformBalanceOf(input.token)).to.equal(input.platformFeeAmount);
    expect(await token.balanceOf(await settlement.getAddress())).to.equal(input.grossAmount);
  }

  async function eip3009Authorization(settlement, token, buyer, input, overrides = {}) {
    const validBefore = overrides.validBefore ?? input.expiresAt;
    const nonce = overrides.nonce ?? (await settlement.paymentAuthorizationHash(input, buyer.address, validBefore));
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await buyer.signTypedData(
      {
        chainId,
        name: await token.name(),
        verifyingContract: await token.getAddress(),
        version: "1",
      },
      {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      {
        from: buyer.address,
        to: await settlement.getAddress(),
        value: input.grossAmount,
        validAfter: overrides.validAfter ?? 0n,
        validBefore,
        nonce,
      },
    );
    const split = ethers.Signature.from(signature);
    return {
      payer: buyer.address,
      validAfter: overrides.validAfter ?? 0n,
      validBefore,
      nonce,
      v: overrides.v ?? split.v,
      r: overrides.r ?? split.r,
      s: overrides.s ?? split.s,
    };
  }

  async function permit2Payment(settlement, permit2, buyer, input, overrides = {}) {
    const deadline = overrides.deadline ?? input.expiresAt;
    const { chainId } = await ethers.provider.getNetwork();
    const nonce = overrides.nonce ?? 1n;
    const permit = {
      permitted: {
        token: input.token,
        amount: overrides.amount ?? input.grossAmount,
      },
      nonce,
      deadline,
    };
    const witnessMessage = {
      intentId: input.intentId,
      projectId: input.projectId,
      payer: buyer.address,
      token: input.token,
      grossAmount: input.grossAmount,
      merchantNetAmount: input.merchantNetAmount,
      platformFeeAmount: input.platformFeeAmount,
      settlement: await settlement.getAddress(),
      chainId,
      deadline,
    };
    const signature = await buyer.signTypedData(
      {
        chainId,
        name: "Permit2",
        verifyingContract: await permit2.getAddress(),
      },
      {
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        ZamaPayEvmPayment: [
          { name: "intentId", type: "bytes32" },
          { name: "projectId", type: "bytes32" },
          { name: "payer", type: "address" },
          { name: "token", type: "address" },
          { name: "grossAmount", type: "uint256" },
          { name: "merchantNetAmount", type: "uint256" },
          { name: "platformFeeAmount", type: "uint256" },
          { name: "settlement", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "ZamaPayEvmPayment" },
        ],
      },
      {
        permitted: permit.permitted,
        spender: await settlement.getAddress(),
        nonce,
        deadline,
        witness: witnessMessage,
      },
    );
    return {
      permit2: await permit2.getAddress(),
      payer: buyer.address,
      permit,
      witness: overrides.witness ?? (await settlement.paymentAuthorizationHash(input, buyer.address, deadline)),
      witnessTypeString:
        overrides.witnessTypeString ?? (await settlement.PERMIT2_PAYMENT_WITNESS_TYPE_STRING()),
      signature: overrides.signature ?? signature,
    };
  }

  async function erc2612Permit(token, settlement, buyer, input) {
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await buyer.signTypedData(
      {
        chainId,
        name: await token.name(),
        verifyingContract: await token.getAddress(),
        version: "1",
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      {
        owner: buyer.address,
        spender: await settlement.getAddress(),
        value: input.grossAmount,
        nonce: await token.nonces(buyer.address),
        deadline: input.expiresAt,
      },
    );
    const split = ethers.Signature.from(signature);
    return { deadline: input.expiresAt, v: split.v, r: split.r, s: split.s };
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

  it("accepts EIP-3009 authorization funding through the same settlement ledger", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    const authorization = await eip3009Authorization(settlement, token, buyer, input);

    await expect(settlement.payWithAuthorization(input, authorization))
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

    await expectPaymentBalances(settlement, token, input);
  });

  it("accepts Permit2 witness funding through the same settlement ledger", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const Permit2 = await ethers.getContractFactory("Permit2SignatureTransferMock");
    const permit2 = await Permit2.deploy();
    await permit2.waitForDeployment();
    const input = await payInput(settlement, token);
    const permit2Input = await permit2Payment(settlement, permit2, buyer, input);
    await token.connect(buyer).approve(await permit2.getAddress(), input.grossAmount);

    await expect(settlement.payWithPermit2(input, permit2Input))
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

    await expectPaymentBalances(settlement, token, input);
    expect(await permit2.lastWitness()).to.equal(permit2Input.witness);
  });

  it("accepts ERC-2612 permit funding only from the payer", async function () {
    const { attacker, buyer, settlement, token } = await deployFixtureWithToken("StandardERC20Mock", "Permit USDT");
    const input = await payInput(settlement, token);
    const permit = await erc2612Permit(token, settlement, buyer, input);

    await expect(settlement.connect(attacker).payWithPermit(input, permit)).to.be.revertedWith("bad permit signature");

    await expect(settlement.connect(buyer).payWithPermit(input, permit))
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

    await expectPaymentBalances(settlement, token, input);
  });

  it("keeps the EvmPaymentAccepted ABI topic unchanged", async function () {
    const topic = ethers.id(
      "EvmPaymentAccepted(bytes32,bytes32,address,address,uint256,uint256,uint256)",
    );
    const iface = new ethers.Interface([
      "event EvmPaymentAccepted(bytes32 indexed intentId, bytes32 indexed projectId, address indexed payer, address token, uint256 grossAmount, uint256 merchantNetAmount, uint256 platformFeeAmount)",
    ]);

    expect(iface.getEvent("EvmPaymentAccepted").topicHash).to.equal(topic);
  });

  it("keeps EIP-3009 settlement gas below the receipt-storage regression threshold", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    const authorization = await eip3009Authorization(settlement, token, buyer, input);
    const receipt = await (await settlement.payWithAuthorization(input, authorization)).wait();

    expect(receipt.gasUsed).to.be.lessThan(220_000n);
  });

  it("does not mutate token or internal balances when funding fails", async function () {
    const { buyer, settlement, token } = await deployFixture();
    const input = await payInput(settlement, token);
    const before = await balances(settlement, token, input);

    await expect(
      settlement
        .connect(buyer)
        .pay(
          input.intentId,
          input.projectId,
          input.token,
          input.grossAmount,
          input.merchantNetAmount,
          input.platformFeeAmount,
          input.expiresAt,
        ),
    ).to.be.revertedWith("transferFrom failed");

    expect(await balances(settlement, token, input)).to.deep.equal(before);
  });

  it("rejects short-transfer ERC20 funding without mutating settlement state", async function () {
    const { buyer, settlement, token } = await deployFixtureWithToken("ShortTransferERC20Mock");
    const input = await payInput(settlement, token);
    const before = await balances(settlement, token, input);

    await token.connect(buyer).approve(await settlement.getAddress(), input.grossAmount);
    await expect(
      settlement
        .connect(buyer)
        .pay(
          input.intentId,
          input.projectId,
          input.token,
          input.grossAmount,
          input.merchantNetAmount,
          input.platformFeeAmount,
          input.expiresAt,
        ),
    ).to.be.revertedWith("funding amount mismatch");

    expect(await balances(settlement, token, input)).to.deep.equal(before);
  });

  it("rejects tampered EIP-3009 and Permit2 business authorization", async function () {
    const eip3009 = await deployFixture();
    const eipInput = await payInput(eip3009.settlement, eip3009.token);
    const eipBefore = await balances(eip3009.settlement, eip3009.token, eipInput);
    const badAuthorization = await eip3009Authorization(eip3009.settlement, eip3009.token, eip3009.buyer, eipInput, {
      nonce: ethers.id("not-zamapay-intent"),
    });
    await expect(eip3009.settlement.payWithAuthorization(eipInput, badAuthorization)).to.be.revertedWith(
      "bad authorization nonce",
    );
    expect(await balances(eip3009.settlement, eip3009.token, eipInput)).to.deep.equal(eipBefore);

    const permitFixture = await deployFixture();
    const Permit2 = await ethers.getContractFactory("Permit2SignatureTransferMock");
    const permit2 = await Permit2.deploy();
    await permit2.waitForDeployment();
    const permitInput = await payInput(permitFixture.settlement, permitFixture.token);
    const permitBefore = await balances(permitFixture.settlement, permitFixture.token, permitInput);
    const badPermit2 = await permit2Payment(permitFixture.settlement, permit2, permitFixture.buyer, permitInput, {
      witness: ethers.id("wrong-witness"),
    });
    await permitFixture.token.connect(permitFixture.buyer).approve(await permit2.getAddress(), permitInput.grossAmount);
    await expect(permitFixture.settlement.payWithPermit2(permitInput, badPermit2)).to.be.revertedWith(
      "bad permit2 witness",
    );
    expect(await balances(permitFixture.settlement, permitFixture.token, permitInput)).to.deep.equal(permitBefore);
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

  it("withdraws merchant balances produced by each funding method", async function () {
    const methods = ["approve-pay", "eip3009", "permit2", "erc2612"];

    for (const method of methods) {
      const { buyer, deployer, merchant, settlement, token } = await deployFixture();
      const input = await payInput(settlement, token, { intentId: ethers.id(`intent:${method}`) });

      if (method === "approve-pay") {
        await submitPayment(settlement, token, buyer, input);
      } else if (method === "eip3009") {
        const authorization = await eip3009Authorization(settlement, token, buyer, input);
        await settlement.payWithAuthorization(input, authorization);
      } else if (method === "permit2") {
        const Permit2 = await ethers.getContractFactory("Permit2SignatureTransferMock");
        const permit2 = await Permit2.deploy();
        await permit2.waitForDeployment();
        const permit2Input = await permit2Payment(settlement, permit2, buyer, input);
        await token.connect(buyer).approve(await permit2.getAddress(), input.grossAmount);
        await settlement.payWithPermit2(input, permit2Input);
      } else {
        const permit = await erc2612Permit(token, settlement, buyer, input);
        await settlement.connect(buyer).payWithPermit(input, permit);
      }

      const { chainId } = await ethers.provider.getNetwork();
      const withdrawal = {
        amount: input.merchantNetAmount,
        deadline: BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
        projectId: input.projectId,
        recipient: merchant.address,
        token: input.token,
        withdrawalId: ethers.id(`withdraw:${method}`),
      };
      const signature = await signWithdraw(deployer, settlement, Number(chainId), withdrawal);
      await settlement.withdrawMerchant(
        withdrawal.projectId,
        withdrawal.token,
        withdrawal.recipient,
        withdrawal.amount,
        withdrawal.withdrawalId,
        withdrawal.deadline,
        signature,
      );

      expect(await settlement.merchantBalanceOf(input.projectId, input.token)).to.equal(0);
      expect(await token.balanceOf(merchant.address)).to.equal(input.merchantNetAmount);
    }
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
