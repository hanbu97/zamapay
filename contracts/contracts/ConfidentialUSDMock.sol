// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialUSDMock is ZamaEthereumConfig {
    string public constant name = "Mermer Confidential USD";
    string public constant symbol = "mcUSD";
    uint8 public constant decimals = 6;

    address public immutable owner;
    uint256 public totalSupply;

    mapping(address => euint64) private _balances;
    mapping(address => mapping(address => euint64)) private _allowances;

    event Mint(address indexed to, uint64 amount);
    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);
    event ConditionalTransfer(address indexed from, address indexed to, address indexed spender, uint64 expectedAmount);
    event ConditionalSplitTransfer(
        address indexed from,
        address indexed merchantWallet,
        address indexed platformWallet,
        uint64 expectedGrossAmount,
        uint64 merchantNetAmount,
        uint64 platformFeeAmount
    );
    event PrivateExactTransfer(address indexed from, address indexed to, address indexed spender);
    event PrivateSplitTransfer(
        address indexed from,
        address indexed merchantWallet,
        address indexed platformWallet,
        address spender
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function mint(address to, uint64 amount) external onlyOwner {
        euint64 minted = FHE.asEuint64(amount);
        FHE.allowThis(minted);
        FHE.allow(minted, to);

        _balances[to] = FHE.add(_balances[to], minted);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        totalSupply += amount;
        emit Mint(to, amount);
    }

    function transfer(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (bool) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
        FHE.allow(amount, to);

        euint64 fromBalance = _balances[msg.sender];
        ebool canTransfer = FHE.ge(fromBalance, amount);
        euint64 moved = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextRecipientBalance = FHE.add(_balances[to], moved);

        FHE.allowThis(moved);
        FHE.allow(moved, msg.sender);
        FHE.allow(moved, to);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, msg.sender);

        FHE.allowThis(nextRecipientBalance);
        FHE.allow(nextRecipientBalance, to);

        _balances[msg.sender] = nextSenderBalance;
        _balances[to] = nextRecipientBalance;

        emit Transfer(msg.sender, to);
        return true;
    }

    function approve(address spender, externalEuint64 encryptedAmount, bytes calldata inputProof) external returns (bool) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
        FHE.allow(amount, spender);

        _allowances[msg.sender][spender] = amount;
        FHE.allowThis(_allowances[msg.sender][spender]);
        FHE.allow(_allowances[msg.sender][spender], spender);

        emit Approval(msg.sender, spender);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (bool) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowThis(amount);
        FHE.allow(amount, from);
        FHE.allow(amount, to);

        euint64 spenderAllowance = _allowances[from][msg.sender];
        euint64 fromBalance = _balances[from];

        ebool enoughAllowance = FHE.ge(spenderAllowance, amount);
        ebool enoughBalance = FHE.ge(fromBalance, amount);
        ebool canTransfer = FHE.and(enoughAllowance, enoughBalance);
        euint64 moved = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 nextAllowance = FHE.select(canTransfer, FHE.sub(spenderAllowance, amount), spenderAllowance);
        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextRecipientBalance = FHE.add(_balances[to], moved);

        FHE.allowThis(moved);
        FHE.allow(moved, from);
        FHE.allow(moved, to);

        FHE.allowThis(nextAllowance);
        FHE.allow(nextAllowance, msg.sender);
        FHE.allow(nextAllowance, from);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, from);

        FHE.allowThis(nextRecipientBalance);
        FHE.allow(nextRecipientBalance, to);

        _allowances[from][msg.sender] = nextAllowance;
        _balances[from] = nextSenderBalance;
        _balances[to] = nextRecipientBalance;

        emit Transfer(from, to);
        return true;
    }

    function transferFromExact(
        address from,
        address to,
        euint64 amount,
        uint64 expectedAmount
    ) external returns (ebool) {
        FHE.allowThis(amount);
        FHE.allow(amount, from);
        FHE.allow(amount, to);

        euint64 spenderAllowance = _allowances[from][msg.sender];
        euint64 fromBalance = _balances[from];

        ebool exactAmount = FHE.eq(amount, expectedAmount);
        ebool enoughAllowance = FHE.ge(spenderAllowance, amount);
        ebool enoughBalance = FHE.ge(fromBalance, amount);
        ebool canTransfer = FHE.and(FHE.and(exactAmount, enoughAllowance), enoughBalance);
        euint64 moved = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 nextAllowance = FHE.select(canTransfer, FHE.sub(spenderAllowance, amount), spenderAllowance);
        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextRecipientBalance = FHE.add(_balances[to], moved);

        FHE.allowThis(canTransfer);
        FHE.allow(canTransfer, msg.sender);

        FHE.allowThis(moved);
        FHE.allow(moved, from);
        FHE.allow(moved, to);

        FHE.allowThis(nextAllowance);
        FHE.allow(nextAllowance, msg.sender);
        FHE.allow(nextAllowance, from);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, from);

        FHE.allowThis(nextRecipientBalance);
        FHE.allow(nextRecipientBalance, to);

        _allowances[from][msg.sender] = nextAllowance;
        _balances[from] = nextSenderBalance;
        _balances[to] = nextRecipientBalance;

        emit ConditionalTransfer(from, to, msg.sender, expectedAmount);
        return canTransfer;
    }

    function transferFromSplitExact(
        address from,
        address merchantWallet,
        address platformWallet,
        euint64 amount,
        uint64 expectedGrossAmount,
        uint64 merchantNetAmount,
        uint64 platformFeeAmount
    ) external returns (ebool) {
        require(merchantWallet != address(0), "merchant wallet required");
        require(platformWallet != address(0), "platform wallet required");
        require(expectedGrossAmount == merchantNetAmount + platformFeeAmount, "split mismatch");

        FHE.allowThis(amount);
        FHE.allow(amount, from);
        FHE.allow(amount, merchantWallet);
        FHE.allow(amount, platformWallet);

        euint64 spenderAllowance = _allowances[from][msg.sender];
        euint64 fromBalance = _balances[from];

        ebool exactAmount = FHE.eq(amount, expectedGrossAmount);
        ebool enoughAllowance = FHE.ge(spenderAllowance, amount);
        ebool enoughBalance = FHE.ge(fromBalance, amount);
        ebool canTransfer = FHE.and(FHE.and(exactAmount, enoughAllowance), enoughBalance);
        euint64 merchantMoved = FHE.select(canTransfer, FHE.asEuint64(merchantNetAmount), FHE.asEuint64(0));
        euint64 platformMoved = FHE.select(canTransfer, FHE.asEuint64(platformFeeAmount), FHE.asEuint64(0));

        euint64 nextAllowance = FHE.select(canTransfer, FHE.sub(spenderAllowance, amount), spenderAllowance);
        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextMerchantBalance = FHE.add(_balances[merchantWallet], merchantMoved);
        euint64 nextPlatformBalance = FHE.add(_balances[platformWallet], platformMoved);

        FHE.allowThis(canTransfer);
        FHE.allow(canTransfer, msg.sender);

        FHE.allowThis(merchantMoved);
        FHE.allow(merchantMoved, from);
        FHE.allow(merchantMoved, merchantWallet);

        FHE.allowThis(platformMoved);
        FHE.allow(platformMoved, from);
        FHE.allow(platformMoved, platformWallet);

        FHE.allowThis(nextAllowance);
        FHE.allow(nextAllowance, msg.sender);
        FHE.allow(nextAllowance, from);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, from);

        FHE.allowThis(nextMerchantBalance);
        FHE.allow(nextMerchantBalance, merchantWallet);

        FHE.allowThis(nextPlatformBalance);
        FHE.allow(nextPlatformBalance, platformWallet);

        _allowances[from][msg.sender] = nextAllowance;
        _balances[from] = nextSenderBalance;
        _balances[merchantWallet] = nextMerchantBalance;
        _balances[platformWallet] = nextPlatformBalance;

        emit ConditionalSplitTransfer(
            from,
            merchantWallet,
            platformWallet,
            expectedGrossAmount,
            merchantNetAmount,
            platformFeeAmount
        );
        return canTransfer;
    }

    function transferFromPrivateExact(
        address from,
        address to,
        euint64 amount,
        euint64 expectedAmount
    ) external returns (ebool) {
        require(to != address(0), "recipient required");

        FHE.allowThis(amount);
        FHE.allow(amount, from);
        FHE.allow(amount, to);
        FHE.allowThis(expectedAmount);

        euint64 spenderAllowance = _allowances[from][msg.sender];
        euint64 fromBalance = _balances[from];

        ebool exactAmount = FHE.eq(amount, expectedAmount);
        ebool enoughAllowance = FHE.ge(spenderAllowance, amount);
        ebool enoughBalance = FHE.ge(fromBalance, amount);
        ebool canTransfer = FHE.and(FHE.and(exactAmount, enoughAllowance), enoughBalance);
        euint64 moved = FHE.select(canTransfer, amount, FHE.asEuint64(0));

        euint64 nextAllowance = FHE.select(canTransfer, FHE.sub(spenderAllowance, amount), spenderAllowance);
        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextRecipientBalance = FHE.add(_balances[to], moved);

        FHE.allowThis(canTransfer);
        FHE.allow(canTransfer, msg.sender);

        FHE.allowThis(moved);
        FHE.allow(moved, from);
        FHE.allow(moved, to);

        FHE.allowThis(nextAllowance);
        FHE.allow(nextAllowance, msg.sender);
        FHE.allow(nextAllowance, from);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, from);

        FHE.allowThis(nextRecipientBalance);
        FHE.allow(nextRecipientBalance, to);

        _allowances[from][msg.sender] = nextAllowance;
        _balances[from] = nextSenderBalance;
        _balances[to] = nextRecipientBalance;

        emit PrivateExactTransfer(from, to, msg.sender);
        return canTransfer;
    }

    function transferFromPrivateSplitExact(
        address from,
        address merchantWallet,
        address platformWallet,
        euint64 amount,
        uint64 expectedGrossAmount,
        euint64 merchantNetAmount,
        euint64 platformFeeAmount
    ) external returns (ebool) {
        require(merchantWallet != address(0), "merchant wallet required");
        require(platformWallet != address(0), "platform wallet required");

        FHE.allowThis(amount);
        FHE.allow(amount, from);
        FHE.allow(amount, merchantWallet);
        FHE.allow(amount, platformWallet);
        FHE.allowThis(merchantNetAmount);
        FHE.allow(merchantNetAmount, merchantWallet);
        FHE.allowThis(platformFeeAmount);
        FHE.allow(platformFeeAmount, platformWallet);

        euint64 spenderAllowance = _allowances[from][msg.sender];
        euint64 fromBalance = _balances[from];
        euint64 splitTotal = FHE.add(merchantNetAmount, platformFeeAmount);

        ebool exactAmount = FHE.eq(amount, expectedGrossAmount);
        ebool splitMatches = FHE.eq(splitTotal, amount);
        ebool enoughAllowance = FHE.ge(spenderAllowance, amount);
        ebool enoughBalance = FHE.ge(fromBalance, amount);
        ebool canTransfer = FHE.and(FHE.and(exactAmount, splitMatches), FHE.and(enoughAllowance, enoughBalance));
        euint64 merchantMoved = FHE.select(canTransfer, merchantNetAmount, FHE.asEuint64(0));
        euint64 platformMoved = FHE.select(canTransfer, platformFeeAmount, FHE.asEuint64(0));

        euint64 nextAllowance = FHE.select(canTransfer, FHE.sub(spenderAllowance, amount), spenderAllowance);
        euint64 nextSenderBalance = FHE.select(canTransfer, FHE.sub(fromBalance, amount), fromBalance);
        euint64 nextMerchantBalance = FHE.add(_balances[merchantWallet], merchantMoved);
        euint64 nextPlatformBalance = FHE.add(_balances[platformWallet], platformMoved);

        FHE.allowThis(canTransfer);
        FHE.allow(canTransfer, msg.sender);

        FHE.allowThis(merchantMoved);
        FHE.allow(merchantMoved, from);
        FHE.allow(merchantMoved, merchantWallet);

        FHE.allowThis(platformMoved);
        FHE.allow(platformMoved, from);
        FHE.allow(platformMoved, platformWallet);

        FHE.allowThis(nextAllowance);
        FHE.allow(nextAllowance, msg.sender);
        FHE.allow(nextAllowance, from);

        FHE.allowThis(nextSenderBalance);
        FHE.allow(nextSenderBalance, from);

        FHE.allowThis(nextMerchantBalance);
        FHE.allow(nextMerchantBalance, merchantWallet);

        FHE.allowThis(nextPlatformBalance);
        FHE.allow(nextPlatformBalance, platformWallet);

        _allowances[from][msg.sender] = nextAllowance;
        _balances[from] = nextSenderBalance;
        _balances[merchantWallet] = nextMerchantBalance;
        _balances[platformWallet] = nextPlatformBalance;

        emit PrivateSplitTransfer(from, merchantWallet, platformWallet, msg.sender);
        return canTransfer;
    }

    function balanceOf(address user) external view returns (euint64) {
        return _balances[user];
    }

    function allowance(address tokenOwner, address spender) external view returns (euint64) {
        return _allowances[tokenOwner][spender];
    }
}
