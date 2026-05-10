// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint16, euint64, externalEuint16, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { SubscriptionPass } from "./SubscriptionPass.sol";

interface IConfidentialSubscriptionChargeToken {
    function debitPrivateExact(address from, address to, euint64 amount, euint64 expectedAmount)
        external
        returns (ebool);
}

contract PrivateSubscriptionRegistry is ZamaEthereumConfig {
    uint16 public constant FREE_PLAN_CODE = 1;
    uint16 public constant GROWTH_PLAN_CODE = 2;
    uint16 public constant FREE_FEE_BPS = 50;
    uint16 public constant GROWTH_FEE_BPS = 25;
    uint64 public constant GROWTH_MONTHLY_PRICE_MINOR_UNITS = 99_000000;
    uint64 public constant GROWTH_ANNUAL_PRICE_MINOR_UNITS = 990_000000;
    uint64 public constant MONTHLY_PERIOD_SECONDS = 30 days;
    uint64 public constant ANNUAL_PERIOD_SECONDS = 365 days;

    struct EncryptedTerms {
        euint16 feeBps;
        euint64 validUntil;
        uint64 version;
        bytes32 billingReferenceHash;
    }

    SubscriptionPass public immutable pass;
    IConfidentialSubscriptionChargeToken public immutable chargeToken;
    address public immutable treasury;
    address public admin;
    address public settlement;

    mapping(address => uint256) public passOfMerchant;
    mapping(uint256 => EncryptedTerms) private _termsByPass;
    mapping(uint256 => ebool) private _subscriptionChecks;

    event PassIssued(address indexed merchant, uint256 indexed passId);
    event SettlementUpdated(address indexed settlement);
    event SubscriptionChangeRequested(
        uint256 indexed passId,
        address indexed merchant,
        bytes32 acceptanceHandle,
        uint64 version
    );
    event SubscriptionChangeFinalized(uint256 indexed passId, address indexed merchant, bool accepted, uint64 version);
    event SubscriptionTermsAnchored(uint256 indexed passId, address indexed merchant, bytes32 billingReferenceHash, uint64 version);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyPassOwner(uint256 passId) {
        require(pass.ownerOf(passId) == msg.sender, "not pass owner");
        _;
    }

    constructor(address passAddress, address chargeTokenAddress, address treasuryAddress) {
        require(passAddress != address(0), "pass required");
        require(chargeTokenAddress != address(0), "charge token required");
        require(treasuryAddress != address(0), "treasury required");
        pass = SubscriptionPass(passAddress);
        chargeToken = IConfidentialSubscriptionChargeToken(chargeTokenAddress);
        treasury = treasuryAddress;
        admin = msg.sender;
    }

    function setSettlement(address settlementAddress) external onlyAdmin {
        require(settlementAddress != address(0), "settlement required");
        settlement = settlementAddress;
        emit SettlementUpdated(settlementAddress);
    }

    function ensureMerchantPass(address merchant) public returns (uint256) {
        require(merchant != address(0), "merchant required");
        require(msg.sender == merchant || msg.sender == settlement || msg.sender == admin, "not authorized");

        uint256 existing = passOfMerchant[merchant];
        if (existing != 0) {
            return existing;
        }

        uint256 passId = pass.mint(merchant);
        passOfMerchant[merchant] = passId;
        _writeDefaultTerms(passId, merchant, bytes32(0));
        emit PassIssued(merchant, passId);
        return passId;
    }

    function requestSubscriptionChange(
        uint256 passId,
        externalEuint16 encryptedPlanCode,
        externalEuint64 encryptedPaidAmount,
        bytes calldata inputProof
    ) external onlyPassOwner(passId) returns (bytes32) {
        return _requestSubscriptionChange(passId, encryptedPlanCode, encryptedPaidAmount, inputProof);
    }

    function requestMerchantSubscriptionChange(
        address merchant,
        externalEuint16 encryptedPlanCode,
        externalEuint64 encryptedPaidAmount,
        bytes calldata inputProof
    ) external returns (uint256 passId, bytes32 acceptanceHandle) {
        require(merchant != address(0), "merchant required");
        require(msg.sender == merchant, "merchant only");
        passId = ensureMerchantPass(merchant);
        acceptanceHandle = _requestSubscriptionChange(passId, encryptedPlanCode, encryptedPaidAmount, inputProof);
    }

    function _requestSubscriptionChange(
        uint256 passId,
        externalEuint16 encryptedPlanCode,
        externalEuint64 encryptedPaidAmount,
        bytes calldata inputProof
    ) private returns (bytes32) {
        address merchant = pass.ownerOf(passId);
        EncryptedTerms storage terms = _termsByPass[passId];
        require(terms.version != 0, "terms not initialized");

        euint16 planCode = FHE.fromExternal(encryptedPlanCode, inputProof);
        euint64 paidAmount = FHE.fromExternal(encryptedPaidAmount, inputProof);

        ebool isFree = FHE.eq(planCode, FREE_PLAN_CODE);
        ebool isGrowth = FHE.eq(planCode, GROWTH_PLAN_CODE);
        ebool planAllowed = FHE.or(isFree, isGrowth);
        euint16 requestedFeeBps = FHE.select(isGrowth, FHE.asEuint16(GROWTH_FEE_BPS), FHE.asEuint16(FREE_FEE_BPS));
        ebool paidAnnual = FHE.eq(paidAmount, GROWTH_ANNUAL_PRICE_MINOR_UNITS);
        euint64 growthRequiredPayment = FHE.select(
            paidAnnual,
            FHE.asEuint64(GROWTH_ANNUAL_PRICE_MINOR_UNITS),
            FHE.asEuint64(GROWTH_MONTHLY_PRICE_MINOR_UNITS)
        );
        euint64 requiredPayment = FHE.select(isGrowth, growthRequiredPayment, FHE.asEuint64(0));
        euint64 paidValidUntil = FHE.select(
            paidAnnual,
            FHE.asEuint64(uint64(block.timestamp) + ANNUAL_PERIOD_SECONDS),
            FHE.asEuint64(uint64(block.timestamp) + MONTHLY_PERIOD_SECONDS)
        );
        euint64 requestedValidUntil = FHE.select(isFree, FHE.asEuint64(type(uint64).max), paidValidUntil);

        FHE.allowTransient(paidAmount, address(chargeToken));
        FHE.allowTransient(requiredPayment, address(chargeToken));
        ebool paid = chargeToken.debitPrivateExact(merchant, treasury, paidAmount, requiredPayment);
        ebool accepted = FHE.and(planAllowed, paid);

        terms.feeBps = FHE.select(accepted, requestedFeeBps, terms.feeBps);
        terms.validUntil = FHE.select(
            accepted,
            requestedValidUntil,
            terms.validUntil
        );
        terms.version += 1;

        _allowTerms(passId, merchant);
        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);
        _subscriptionChecks[passId] = accepted;

        emit SubscriptionChangeRequested(passId, merchant, FHE.toBytes32(accepted), terms.version);
        return FHE.toBytes32(accepted);
    }

    function anchorEncryptedTerms(
        uint256 passId,
        externalEuint16 encryptedFeeBps,
        externalEuint64 encryptedValidUntil,
        bytes calldata inputProof,
        bytes32 billingReferenceHash
    ) external onlyAdmin {
        address merchant = pass.ownerOf(passId);
        EncryptedTerms storage terms = _termsByPass[passId];
        terms.feeBps = FHE.fromExternal(encryptedFeeBps, inputProof);
        terms.validUntil = FHE.fromExternal(encryptedValidUntil, inputProof);
        terms.version += 1;
        terms.billingReferenceHash = billingReferenceHash;
        _allowTerms(passId, merchant);
        emit SubscriptionTermsAnchored(passId, merchant, billingReferenceHash, terms.version);
    }

    function finalizeSubscriptionChange(
        uint256 passId,
        bytes calldata abiEncodedAccepted,
        bytes calldata decryptionProof
    ) external {
        address merchant = pass.ownerOf(passId);
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(_subscriptionChecks[passId]);
        FHE.checkSignatures(handles, abiEncodedAccepted, decryptionProof);

        bool accepted = abi.decode(abiEncodedAccepted, (bool));
        emit SubscriptionChangeFinalized(passId, merchant, accepted, _termsByPass[passId].version);
    }

    function termsForMerchant(address merchant) external returns (euint16 feeBps, euint64 validUntil, uint64 version) {
        require(msg.sender == settlement, "settlement only");
        uint256 passId = ensureMerchantPass(merchant);
        EncryptedTerms storage terms = _termsByPass[passId];
        FHE.allowTransient(terms.feeBps, msg.sender);
        FHE.allowTransient(terms.validUntil, msg.sender);
        return (terms.feeBps, terms.validUntil, terms.version);
    }

    function feeBpsOf(uint256 passId) external view returns (euint16) {
        return _termsByPass[passId].feeBps;
    }

    function validUntilOf(uint256 passId) external view returns (euint64) {
        return _termsByPass[passId].validUntil;
    }

    function subscriptionCheckHandleOf(uint256 passId) external view returns (bytes32) {
        return FHE.toBytes32(_subscriptionChecks[passId]);
    }

    function termsVersionOf(uint256 passId) external view returns (uint64) {
        return _termsByPass[passId].version;
    }

    function _writeDefaultTerms(uint256 passId, address merchant, bytes32 billingReferenceHash) private {
        EncryptedTerms storage terms = _termsByPass[passId];
        terms.feeBps = FHE.asEuint16(FREE_FEE_BPS);
        terms.validUntil = FHE.asEuint64(type(uint64).max);
        terms.version = 1;
        terms.billingReferenceHash = billingReferenceHash;
        _allowTerms(passId, merchant);
    }

    function _allowTerms(uint256 passId, address merchant) private {
        EncryptedTerms storage terms = _termsByPass[passId];
        FHE.allowThis(terms.feeBps);
        FHE.allow(terms.feeBps, merchant);
        FHE.allowThis(terms.validUntil);
        FHE.allow(terms.validUntil, merchant);
    }
}
