// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MockConfidentialPaymentRail is ZamaEthereumConfig {
    address public admin;
    address public settlement;

    mapping(bytes32 => euint64) private _balances;
    mapping(bytes32 => ebool) private _debitChecks;

    event SettlementUpdated(address indexed settlement);
    event ConfidentialBalanceFunded(bytes32 indexed accountCommitment, bytes32 balanceHandle);
    event ConfidentialDebitSubmitted(
        bytes32 indexed accountCommitment,
        bytes32 debitCheckHandle,
        bytes32 balanceHandle
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == settlement, "settlement only");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function setSettlement(address settlementAddress) external onlyAdmin {
        require(settlementAddress != address(0), "settlement required");
        settlement = settlementAddress;
        emit SettlementUpdated(settlementAddress);
    }

    function fund(
        bytes32 accountCommitment,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAdmin {
        require(accountCommitment != bytes32(0), "account commitment required");

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 nextBalance = FHE.add(_balances[accountCommitment], amount);

        FHE.allowThis(nextBalance);
        _balances[accountCommitment] = nextBalance;

        emit ConfidentialBalanceFunded(accountCommitment, FHE.toBytes32(nextBalance));
    }

    function debitExact(bytes32 accountCommitment, euint64 amount) external onlySettlement returns (ebool) {
        require(accountCommitment != bytes32(0), "account commitment required");

        euint64 balance = _balances[accountCommitment];
        ebool accepted = FHE.ge(balance, amount);
        euint64 nextBalance = FHE.select(accepted, FHE.sub(balance, amount), balance);

        FHE.allowThis(accepted);
        FHE.allow(accepted, msg.sender);
        FHE.allowThis(nextBalance);

        _debitChecks[accountCommitment] = accepted;
        _balances[accountCommitment] = nextBalance;

        emit ConfidentialDebitSubmitted(
            accountCommitment,
            FHE.toBytes32(accepted),
            FHE.toBytes32(nextBalance)
        );
        return accepted;
    }

    function balanceOf(bytes32 accountCommitment) external view returns (euint64) {
        return _balances[accountCommitment];
    }

    function balanceHandleOf(bytes32 accountCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_balances[accountCommitment]);
    }

    function debitCheckHandleOf(bytes32 accountCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_debitChecks[accountCommitment]);
    }
}
