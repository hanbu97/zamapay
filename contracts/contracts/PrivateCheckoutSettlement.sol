// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IPrivateCheckoutToken {
    function debitExact(address account, euint64 amount) external returns (ebool);
    function debitPrivateExact(address from, address to, euint64 amount, euint64 expectedAmount) external returns (ebool);
}

contract PrivateCheckoutSettlement is ZamaEthereumConfig {
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant WITHDRAW_AUTH_TYPEHASH =
        keccak256(
            "PrivateWithdraw(bytes32 settlementBucketCommitment,bytes32 withdrawalNonce,address bucketOwner,address recipient,bytes32 encryptedAmount,bytes32 inputProofHash,uint64 deadline)"
        );

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
        euint64 merchantNetAmount;
        euint64 platformFeeAmount;
        ebool splitCheck;
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
    mapping(bytes32 => bytes32) private _bucketOwnerCommitments;
    mapping(bytes32 => euint64) private _merchantPendingByBucket;
    mapping(bytes32 => euint64) private _platformPendingByBucket;
    mapping(bytes32 => ebool) private _withdrawChecks;
    mapping(bytes32 => bool) public paymentNonceUsed;
    mapping(bytes32 => bool) public withdrawalNonceUsed;

    event PrivateCheckoutCreated(bytes32 indexed orderCommitment, bytes32 indexed settlementBucketCommitment);
    event PrivatePaymentSubmitted(bytes32 indexed orderCommitment, bytes32 paymentCheckHandle);
    event PrivatePaymentFinalized(bytes32 indexed orderCommitment, bool accepted, uint256 paidAt);
    event PrivateCheckoutExpired(bytes32 indexed orderCommitment);
    event PrivateMerchantPendingCredited(bytes32 indexed orderCommitment, bytes32 indexed settlementBucketCommitment, bytes32 merchantPendingHandle);
    event PrivateWithdrawSubmitted(bytes32 indexed settlementBucketCommitment, bytes32 indexed withdrawalNonce, bytes32 withdrawCheckHandle);

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
        bytes32 bucketOwnerCommitment,
        externalEuint64 encryptedExpectedAmount,
        externalEuint64 encryptedMerchantNetAmount,
        externalEuint64 encryptedPlatformFeeAmount,
        bytes calldata inputProof,
        uint64 expiresAt
    ) external onlyCheckoutCreator returns (uint256) {
        require(orderCommitment != bytes32(0), "order commitment required");
        require(settlementBucketCommitment != bytes32(0), "bucket commitment required");
        require(bucketOwnerCommitment != bytes32(0), "bucket owner commitment required");
        require(_checkouts[orderCommitment].status == PaymentStatus.None, "checkout exists");
        require(expiresAt > block.timestamp, "expiry must be in future");
        bytes32 existingBucketOwnerCommitment = _bucketOwnerCommitments[settlementBucketCommitment];
        require(
            existingBucketOwnerCommitment == bytes32(0) || existingBucketOwnerCommitment == bucketOwnerCommitment,
            "bucket owner mismatch"
        );

        uint256 checkoutId = checkoutCount++;
        euint64 expectedAmount = FHE.fromExternal(encryptedExpectedAmount, inputProof);
        euint64 merchantNetAmount = FHE.fromExternal(encryptedMerchantNetAmount, inputProof);
        euint64 platformFeeAmount = FHE.fromExternal(encryptedPlatformFeeAmount, inputProof);
        ebool splitCheck = FHE.eq(FHE.add(merchantNetAmount, platformFeeAmount), expectedAmount);

        FHE.allowThis(expectedAmount);
        FHE.allowThis(merchantNetAmount);
        FHE.allowThis(platformFeeAmount);
        FHE.allowThis(splitCheck);

        _checkouts[orderCommitment] = PrivateCheckout({
            orderCommitment: orderCommitment,
            settlementBucketCommitment: settlementBucketCommitment,
            expectedAmount: expectedAmount,
            merchantNetAmount: merchantNetAmount,
            platformFeeAmount: platformFeeAmount,
            splitCheck: splitCheck,
            paymentCheck: FHE.asEbool(false),
            status: PaymentStatus.Created,
            expiresAt: expiresAt,
            paidAt: 0
        });
        if (existingBucketOwnerCommitment == bytes32(0)) {
            _bucketOwnerCommitments[settlementBucketCommitment] = bucketOwnerCommitment;
        }
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
        ebool payableCheck = FHE.and(amountMatches, checkout.splitCheck);
        euint64 chargeAmount = FHE.select(payableCheck, paidAmount, FHE.asEuint64(0));

        FHE.allowTransient(chargeAmount, address(paymentToken));
        ebool tokenDebited = paymentToken.debitExact(msg.sender, chargeAmount);
        ebool accepted = FHE.and(payableCheck, tokenDebited);

        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);
        checkout.paymentCheck = accepted;
        checkout.status = PaymentStatus.Submitted;
        _creditAcceptedPayment(checkout, accepted);

        bytes32 paymentCheckHandle = FHE.toBytes32(accepted);
        emit PrivatePaymentSubmitted(orderCommitment, paymentCheckHandle);
        return paymentCheckHandle;
    }

    function requestPrivateWithdraw(
        bytes32 settlementBucketCommitment,
        bytes32 withdrawalNonce,
        address bucketOwner,
        address recipient,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        uint64 deadline,
        bytes calldata authorization
    ) external returns (bytes32) {
        require(settlementBucketCommitment != bytes32(0), "bucket commitment required");
        require(withdrawalNonce != bytes32(0), "nonce required");
        require(bucketOwner != address(0), "bucket owner required");
        require(recipient != address(0), "recipient required");
        require(block.timestamp <= deadline, "withdraw authorization expired");
        require(!withdrawalNonceUsed[withdrawalNonce], "nonce used");
        require(
            _bucketOwnerCommitments[settlementBucketCommitment] == bucketOwnerCommitmentOf(settlementBucketCommitment, bucketOwner),
            "bucket owner only"
        );

        bytes32 inputProofHash = keccak256(inputProof);
        bytes32 encryptedAmountHandle = externalEuint64.unwrap(encryptedAmount);
        bytes32 digest = withdrawAuthorizationDigest(
            settlementBucketCommitment,
            withdrawalNonce,
            bucketOwner,
            recipient,
            encryptedAmountHandle,
            inputProofHash,
            deadline
        );
        require(_recoverSigner(digest, authorization) == bucketOwner, "invalid withdraw authorization");

        withdrawalNonceUsed[withdrawalNonce] = true;

        euint64 requestedAmount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 pending = _merchantPendingByBucket[settlementBucketCommitment];
        ebool enoughPending = FHE.ge(pending, requestedAmount);
        euint64 moved = FHE.select(enoughPending, requestedAmount, FHE.asEuint64(0));

        FHE.allowTransient(moved, address(paymentToken));
        ebool tokenTransferred = paymentToken.debitPrivateExact(address(this), recipient, moved, moved);
        ebool accepted = FHE.and(enoughPending, tokenTransferred);
        euint64 nextPending = FHE.select(accepted, FHE.sub(pending, moved), pending);

        FHE.allowThis(accepted);
        FHE.allow(accepted, bucketOwner);
        FHE.makePubliclyDecryptable(accepted);
        FHE.allowThis(nextPending);
        FHE.allow(nextPending, bucketOwner);

        _merchantPendingByBucket[settlementBucketCommitment] = nextPending;
        _withdrawChecks[withdrawalNonce] = accepted;

        bytes32 withdrawCheckHandle = FHE.toBytes32(accepted);
        emit PrivateWithdrawSubmitted(settlementBucketCommitment, withdrawalNonce, withdrawCheckHandle);
        return withdrawCheckHandle;
    }

    function withdrawAuthorizationDigest(
        bytes32 settlementBucketCommitment,
        bytes32 withdrawalNonce,
        address bucketOwner,
        address recipient,
        bytes32 encryptedAmount,
        bytes32 inputProofHash,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAW_AUTH_TYPEHASH,
                settlementBucketCommitment,
                withdrawalNonce,
                bucketOwner,
                recipient,
                encryptedAmount,
                inputProofHash,
                deadline
            )
        );

        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function bucketOwnerCommitmentOf(bytes32 settlementBucketCommitment, address bucketOwner) public pure returns (bytes32) {
        require(settlementBucketCommitment != bytes32(0), "bucket commitment required");
        require(bucketOwner != address(0), "bucket owner required");
        return keccak256(abi.encodePacked(settlementBucketCommitment, bucketOwner));
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

    function merchantPendingHandleOf(bytes32 settlementBucketCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_merchantPendingByBucket[settlementBucketCommitment]);
    }

    function platformPendingHandleOf(bytes32 settlementBucketCommitment) external view returns (bytes32) {
        return FHE.toBytes32(_platformPendingByBucket[settlementBucketCommitment]);
    }

    function withdrawalCheckHandleOf(bytes32 withdrawalNonce) external view returns (bytes32) {
        return FHE.toBytes32(_withdrawChecks[withdrawalNonce]);
    }

    function settlementBucketCommitmentOf(bytes32 orderCommitment) external view returns (bytes32) {
        return _checkouts[orderCommitment].settlementBucketCommitment;
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

    function _creditAcceptedPayment(PrivateCheckout storage checkout, ebool accepted) private {
        bytes32 settlementBucketCommitment = checkout.settlementBucketCommitment;
        euint64 merchantCredit = FHE.select(accepted, checkout.merchantNetAmount, FHE.asEuint64(0));
        euint64 platformCredit = FHE.select(accepted, checkout.platformFeeAmount, FHE.asEuint64(0));
        euint64 nextMerchantPending = FHE.add(_merchantPendingByBucket[settlementBucketCommitment], merchantCredit);
        euint64 nextPlatformPending = FHE.add(_platformPendingByBucket[settlementBucketCommitment], platformCredit);

        FHE.allowThis(nextMerchantPending);
        FHE.allowThis(nextPlatformPending);

        _merchantPendingByBucket[settlementBucketCommitment] = nextMerchantPending;
        _platformPendingByBucket[settlementBucketCommitment] = nextPlatformPending;

        emit PrivateMerchantPendingCredited(
            checkout.orderCommitment,
            settlementBucketCommitment,
            FHE.toBytes32(nextMerchantPending)
        );
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("MermerPayPrivateCheckoutSettlement")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address) {
        require(signature.length == 65, "invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "invalid signature v");

        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "invalid signature");
        return signer;
    }
}
