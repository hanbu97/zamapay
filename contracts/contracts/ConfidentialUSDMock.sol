// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialUSDMock is ZamaEthereumConfig {
    string public constant name = "Mermer Confidential USD";
    string public constant symbol = "cUSDT";
    uint8 public constant decimals = 6;
    uint64 public constant TEST_CLAIM_AMOUNT = 1000_000000;

    address public immutable owner;
    address public settlement;
    uint256 public totalSupply;

    mapping(address => euint64) private _balances;
    mapping(address => mapping(address => euint64)) private _allowances;

    event Mint(address indexed to, uint64 amount);
    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);
    event PrivateExactTransfer(address indexed from, address indexed to, address indexed spender);
    event SettlementUpdated(address indexed settlement);
    event TestTokensClaimed(address indexed account, uint64 amount);
    event PrivateDebit(address indexed account);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == settlement, "settlement only");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setSettlement(address settlementAddress) external onlyOwner {
        require(settlementAddress != address(0), "settlement required");
        settlement = settlementAddress;
        emit SettlementUpdated(settlementAddress);
    }

    function mint(address to, uint64 amount) external onlyOwner {
        _mint(to, amount);
    }

    function claimTestTokens() external returns (uint64) {
        _mint(msg.sender, TEST_CLAIM_AMOUNT);
        emit TestTokensClaimed(msg.sender, TEST_CLAIM_AMOUNT);
        return TEST_CLAIM_AMOUNT;
    }

    function debitExact(address account, euint64 amount) external onlySettlement returns (ebool) {
        require(account != address(0), "account required");

        euint64 balance = _balances[account];
        ebool accepted = FHE.ge(balance, amount);
        euint64 moved = FHE.select(accepted, amount, FHE.asEuint64(0));
        euint64 nextBalance = FHE.sub(balance, moved);
        euint64 nextSettlementBalance = FHE.add(_balances[msg.sender], moved);

        FHE.allowThis(accepted);
        FHE.allow(accepted, msg.sender);
        FHE.allowThis(nextBalance);
        FHE.allow(nextBalance, account);
        FHE.allowThis(nextSettlementBalance);
        FHE.allow(nextSettlementBalance, msg.sender);

        _balances[account] = nextBalance;
        _balances[msg.sender] = nextSettlementBalance;

        emit PrivateDebit(account);
        return accepted;
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

    function balanceOf(address user) external view returns (euint64) {
        return _balances[user];
    }

    function allowance(address tokenOwner, address spender) external view returns (euint64) {
        return _allowances[tokenOwner][spender];
    }

    function _mint(address to, uint64 amount) private {
        require(to != address(0), "recipient required");

        euint64 minted = FHE.asEuint64(amount);
        euint64 nextBalance = FHE.add(_balances[to], minted);

        FHE.allowThis(nextBalance);
        FHE.allow(nextBalance, to);

        _balances[to] = nextBalance;
        totalSupply += amount;

        emit Mint(to, amount);
    }
}
