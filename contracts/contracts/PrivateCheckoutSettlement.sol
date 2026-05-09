// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IPrivateCheckoutToken {
    function debitExact(address account, euint64 amount) external returns (ebool);
}

contract PrivateCheckoutSettlement is ZamaEthereumConfig {
    enum PaymentStatus {
        None,
        Created,
        Submitted,
        Accepted,
        Rejected,
        Expired
    }

    struct PrivateCheckout {
        bytes32 orderCommitment;
        bytes32 settlementBucketCommitment;
        euint64 expectedAmount;
        ebool paymentCheck;
        PaymentStatus status;
        uint64 expiresAt;
        uint256 paidAt;
    }

    address public immutable checkoutCreator;
    IPrivateCheckoutToken public immutable paymentToken;
    uint256 public checkoutCount;

    mapping(bytes32 => PrivateCheckout) private _checkouts;
    mapping(uint256 => bytes32) private _orderCommitments;
    mapping(bytes32 => uint256) private _checkoutIdPlusOne;
    mapping(bytes32 => bool) public paymentNonceUsed;

    event PrivateCheckoutCreated(bytes32 indexed orderCommitment, bytes32 indexed settlementBucketCommitment);
    event PrivatePaymentSubmitted(bytes32 indexed orderCommitment, bytes32 paymentCheckHandle);
    event PrivatePaymentFinalized(bytes32 indexed orderCommitment, bool accepted, uint256 paidAt);
    event PrivateCheckoutExpired(bytes32 indexed orderCommitment);

    modifier onlyCheckoutCreator() {
        require(msg.sender == checkoutCreator, "creator only");
        _;
    }

    constructor(address paymentTokenAddress) {
        require(paymentTokenAddress != address(0), "payment token required");
        paymentToken = IPrivateCheckoutToken(paymentTokenAddress);
        checkoutCreator = msg.sender;
    }

    function createPrivateCheckout(
        bytes32 orderCommitment,
        bytes32 settlementBucketCommitment,
        externalEuint64 encryptedExpectedAmount,
        bytes calldata inputProof,
        uint64 expiresAt
    ) external onlyCheckoutCreator returns (uint256) {
        require(orderCommitment != bytes32(0), "order commitment required");
        require(settlementBucketCommitment != bytes32(0), "bucket commitment required");
        require(_checkouts[orderCommitment].status == PaymentStatus.None, "checkout exists");
        require(expiresAt > block.timestamp, "expiry must be in future");

        uint256 checkoutId = checkoutCount++;
        euint64 expectedAmount = FHE.fromExternal(encryptedExpectedAmount, inputProof);
        FHE.allowThis(expectedAmount);

        _checkouts[orderCommitment] = PrivateCheckout({
            orderCommitment: orderCommitment,
            settlementBucketCommitment: settlementBucketCommitment,
            expectedAmount: expectedAmount,
            paymentCheck: FHE.asEbool(false),
            status: PaymentStatus.Created,
            expiresAt: expiresAt,
            paidAt: 0
        });
        _orderCommitments[checkoutId] = orderCommitment;
        _checkoutIdPlusOne[orderCommitment] = checkoutId + 1;

        emit PrivateCheckoutCreated(orderCommitment, settlementBucketCommitment);
        return checkoutId;
    }

    function submitPrivatePayment(
        bytes32 orderCommitment,
        bytes32 paymentNonce,
        externalEuint64 encryptedPaidAmount,
        bytes calldata inputProof
    ) external returns (bytes32) {
        PrivateCheckout storage checkout = _checkouts[orderCommitment];
        require(checkout.status == PaymentStatus.Created, "checkout not payable");
        require(block.timestamp <= checkout.expiresAt, "checkout expired");
        require(paymentNonce != bytes32(0), "nonce required");
        require(!paymentNonceUsed[paymentNonce], "nonce used");

        paymentNonceUsed[paymentNonce] = true;

        euint64 paidAmount = FHE.fromExternal(encryptedPaidAmount, inputProof);
        ebool amountMatches = FHE.eq(paidAmount, checkout.expectedAmount);
        euint64 chargeAmount = FHE.select(amountMatches, paidAmount, FHE.asEuint64(0));

        FHE.allowTransient(chargeAmount, address(paymentToken));
        ebool tokenDebited = paymentToken.debitExact(msg.sender, chargeAmount);
        ebool accepted = FHE.and(amountMatches, tokenDebited);

        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);
        checkout.paymentCheck = accepted;
        checkout.status = PaymentStatus.Submitted;

        bytes32 paymentCheckHandle = FHE.toBytes32(accepted);
        emit PrivatePaymentSubmitted(orderCommitment, paymentCheckHandle);
        return paymentCheckHandle;
    }

    function finalizePrivatePayment(
        bytes32 orderCommitment,
        bytes calldata abiEncodedPaymentAccepted,
        bytes calldata decryptionProof
    ) external {
        PrivateCheckout storage checkout = _checkouts[orderCommitment];
        require(checkout.status == PaymentStatus.Submitted, "checkout not submitted");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(checkout.paymentCheck);
        FHE.checkSignatures(handles, abiEncodedPaymentAccepted, decryptionProof);

        bool accepted = abi.decode(abiEncodedPaymentAccepted, (bool));
        if (accepted) {
            checkout.status = PaymentStatus.Accepted;
            checkout.paidAt = block.timestamp;
        } else {
            checkout.status = PaymentStatus.Rejected;
        }

        emit PrivatePaymentFinalized(orderCommitment, accepted, checkout.paidAt);
    }

    function expirePrivateCheckout(bytes32 orderCommitment) external {
        PrivateCheckout storage checkout = _checkouts[orderCommitment];
        require(checkout.status == PaymentStatus.Created, "checkout not expirable");
        require(block.timestamp > checkout.expiresAt, "checkout still active");

        checkout.status = PaymentStatus.Expired;
        emit PrivateCheckoutExpired(orderCommitment);
    }

    function checkoutIdOf(bytes32 orderCommitment) external view returns (uint256) {
        uint256 idPlusOne = _checkoutIdPlusOne[orderCommitment];
        require(idPlusOne != 0, "checkout not found");
        return idPlusOne - 1;
    }

    function orderCommitmentOf(uint256 checkoutId) external view returns (bytes32) {
        require(checkoutId < checkoutCount, "checkout not found");
        return _orderCommitments[checkoutId];
    }

    function paymentCheckHandleOf(bytes32 orderCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_checkouts[orderCommitment].paymentCheck);
    }

    function expectedAmountHandleOf(bytes32 orderCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_checkouts[orderCommitment].expectedAmount);
    }

    function statusOf(bytes32 orderCommitment) external view returns (PaymentStatus) {
        return _checkouts[orderCommitment].status;
    }

    function expiresAtOf(bytes32 orderCommitment) external view returns (uint64) {
        return _checkouts[orderCommitment].expiresAt;
    }

    function paidAtOf(bytes32 orderCommitment) external view returns (uint256) {
        return _checkouts[orderCommitment].paidAt;
    }
}
