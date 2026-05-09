// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint16, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IMerchantRegistry {
    function isMerchant(address merchant) external view returns (bool);
    function payoutWalletOf(address merchant) external view returns (address);
}

interface IPrivateSubscriptionRegistry {
    function ensureMerchantPass(address merchant) external returns (uint256);
    function termsForMerchant(address merchant) external returns (euint16 feeBps, euint64 validUntil, uint64 version);
}

interface IConfidentialUSD {
    function transferFromPrivateSplitExact(
        address from,
        address merchantWallet,
        address platformWallet,
        euint64 amount,
        uint64 expectedGrossAmount,
        euint64 merchantNetAmount,
        euint64 platformFeeAmount
    ) external returns (ebool);
}

contract ConfidentialInvoiceSettlement is ZamaEthereumConfig {
    uint16 public constant DEFAULT_FEE_BPS = 50;

    enum PaymentTruth {
        Draft,
        PendingPayment,
        VerifyingPayment,
        Paid,
        Expired,
        Failed
    }

    struct Invoice {
        uint256 id;
        address merchant;
        address payoutWallet;
        string externalRef;
        uint256 expiresAt;
        uint64 amountDue;
        uint64 subscriptionTermsVersion;
        PaymentTruth paymentTruth;
        address payer;
        uint256 paidAt;
    }

    IMerchantRegistry public immutable merchantRegistry;
    IPrivateSubscriptionRegistry public immutable subscriptionRegistry;
    IConfidentialUSD public immutable settlementToken;
    address public immutable platformFeeWallet;
    uint256 public invoiceCount;

    mapping(uint256 => Invoice) public invoices;
    mapping(uint256 => euint16) private _invoiceFeeBps;
    mapping(uint256 => euint64) private _settledAmounts;
    mapping(uint256 => euint64) private _platformFeeAmounts;
    mapping(uint256 => ebool) private _paymentChecks;

    event InvoiceCreated(
        uint256 indexed invoiceId,
        address indexed merchant,
        string externalRef,
        uint256 expiresAt,
        uint64 amountDue,
        uint64 subscriptionTermsVersion
    );
    event InvoicePaymentSubmitted(
        uint256 indexed invoiceId,
        address indexed merchant,
        address indexed payer,
        bytes32 paymentCheckHandle
    );
    event InvoicePaymentRejected(uint256 indexed invoiceId, address indexed merchant, address indexed payer);
    event InvoicePaid(uint256 indexed invoiceId, address indexed merchant, address indexed payer);
    event InvoicePaymentSplit(
        uint256 indexed invoiceId,
        bytes32 settledAmountHandle,
        bytes32 platformFeeAmountHandle
    );
    event InvoiceExpired(uint256 indexed invoiceId);

    modifier onlyRegisteredMerchant() {
        require(merchantRegistry.isMerchant(msg.sender), "merchant not registered");
        _;
    }

    modifier onlyInvoiceMerchant(uint256 invoiceId) {
        require(invoices[invoiceId].merchant == msg.sender, "not invoice merchant");
        _;
    }

    constructor(
        address merchantRegistryAddress,
        address subscriptionRegistryAddress,
        address settlementTokenAddress,
        address platformFeeWalletAddress
    ) {
        require(merchantRegistryAddress != address(0), "merchant registry required");
        require(subscriptionRegistryAddress != address(0), "subscription registry required");
        require(settlementTokenAddress != address(0), "settlement token required");
        require(platformFeeWalletAddress != address(0), "platform fee wallet required");
        merchantRegistry = IMerchantRegistry(merchantRegistryAddress);
        subscriptionRegistry = IPrivateSubscriptionRegistry(subscriptionRegistryAddress);
        settlementToken = IConfidentialUSD(settlementTokenAddress);
        platformFeeWallet = platformFeeWalletAddress;
    }

    function createInvoice(string calldata externalRef, uint256 expiresAt, uint64 amountDue)
        external
        onlyRegisteredMerchant
        returns (uint256)
    {
        require(expiresAt > block.timestamp, "expiry must be in future");
        require(amountDue > 0, "amount due required");

        uint256 invoiceId = invoiceCount++;
        address payoutWallet = merchantRegistry.payoutWalletOf(msg.sender);
        subscriptionRegistry.ensureMerchantPass(msg.sender);
        (euint16 feeBps, euint64 validUntil, uint64 termsVersion) = subscriptionRegistry.termsForMerchant(msg.sender);
        ebool activeSubscription = FHE.ge(validUntil, uint64(block.timestamp));
        euint16 invoiceFeeBps = FHE.select(activeSubscription, feeBps, FHE.asEuint16(DEFAULT_FEE_BPS));

        invoices[invoiceId] = Invoice({
            id: invoiceId,
            merchant: msg.sender,
            payoutWallet: payoutWallet,
            externalRef: externalRef,
            expiresAt: expiresAt,
            amountDue: amountDue,
            subscriptionTermsVersion: termsVersion,
            paymentTruth: PaymentTruth.PendingPayment,
            payer: address(0),
            paidAt: 0
        });

        _invoiceFeeBps[invoiceId] = invoiceFeeBps;
        FHE.allowThis(_invoiceFeeBps[invoiceId]);

        _settledAmounts[invoiceId] = FHE.asEuint64(0);
        FHE.allowThis(_settledAmounts[invoiceId]);
        FHE.allow(_settledAmounts[invoiceId], msg.sender);
        FHE.allow(_settledAmounts[invoiceId], payoutWallet);

        _platformFeeAmounts[invoiceId] = FHE.asEuint64(0);
        FHE.allowThis(_platformFeeAmounts[invoiceId]);
        FHE.allow(_platformFeeAmounts[invoiceId], platformFeeWallet);

        emit InvoiceCreated(invoiceId, msg.sender, externalRef, expiresAt, amountDue, termsVersion);
        return invoiceId;
    }

    function payInvoice(uint256 invoiceId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        Invoice storage invoice = invoices[invoiceId];
        require(invoice.merchant != address(0), "invoice not found");
        require(invoice.paymentTruth == PaymentTruth.PendingPayment, "invoice not payable");
        require(block.timestamp <= invoice.expiresAt, "invoice expired");

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        euint16 effectiveFeeBps = _invoiceFeeBps[invoiceId];
        euint64 feeNumerator = FHE.add(FHE.mul(amount, effectiveFeeBps), uint64(9999));
        euint64 platformFeeAmount = FHE.div(feeNumerator, uint64(10_000));
        euint64 merchantNetAmount = FHE.sub(amount, platformFeeAmount);

        FHE.allowTransient(amount, address(settlementToken));
        FHE.allowTransient(merchantNetAmount, address(settlementToken));
        FHE.allowTransient(platformFeeAmount, address(settlementToken));

        ebool accepted = settlementToken.transferFromPrivateSplitExact(
            msg.sender,
            invoice.payoutWallet,
            platformFeeWallet,
            amount,
            invoice.amountDue,
            merchantNetAmount,
            platformFeeAmount
        );
        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);

        euint64 settledAmount = FHE.select(accepted, merchantNetAmount, FHE.asEuint64(0));
        euint64 acceptedPlatformFee = FHE.select(accepted, platformFeeAmount, FHE.asEuint64(0));
        FHE.allowThis(settledAmount);
        FHE.allow(settledAmount, invoice.merchant);
        FHE.allow(settledAmount, invoice.payoutWallet);
        FHE.allowThis(acceptedPlatformFee);
        FHE.allow(acceptedPlatformFee, platformFeeWallet);

        euint64 nextSettledAmount = FHE.add(_settledAmounts[invoiceId], settledAmount);
        euint64 nextPlatformFeeAmount = FHE.add(_platformFeeAmounts[invoiceId], acceptedPlatformFee);
        FHE.allowThis(nextSettledAmount);
        FHE.allow(nextSettledAmount, msg.sender);
        FHE.allow(nextSettledAmount, invoice.merchant);
        FHE.allow(nextSettledAmount, invoice.payoutWallet);
        FHE.allowThis(nextPlatformFeeAmount);
        FHE.allow(nextPlatformFeeAmount, platformFeeWallet);

        _paymentChecks[invoiceId] = accepted;
        _settledAmounts[invoiceId] = nextSettledAmount;
        _platformFeeAmounts[invoiceId] = nextPlatformFeeAmount;
        invoice.paymentTruth = PaymentTruth.VerifyingPayment;
        invoice.payer = msg.sender;

        emit InvoicePaymentSubmitted(invoiceId, invoice.merchant, msg.sender, FHE.toBytes32(accepted));
    }

    function finalizePayment(
        uint256 invoiceId,
        bytes calldata abiEncodedPaymentAccepted,
        bytes calldata decryptionProof
    ) external {
        Invoice storage invoice = invoices[invoiceId];
        require(invoice.merchant != address(0), "invoice not found");
        require(invoice.paymentTruth == PaymentTruth.VerifyingPayment, "invoice not verifying");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(_paymentChecks[invoiceId]);
        FHE.checkSignatures(handles, abiEncodedPaymentAccepted, decryptionProof);

        bool accepted = abi.decode(abiEncodedPaymentAccepted, (bool));
        address payer = invoice.payer;

        if (!accepted) {
            invoice.paymentTruth = PaymentTruth.PendingPayment;
            invoice.payer = address(0);
            emit InvoicePaymentRejected(invoiceId, invoice.merchant, payer);
            return;
        }

        invoice.paymentTruth = PaymentTruth.Paid;
        invoice.paidAt = block.timestamp;
        emit InvoicePaid(invoiceId, invoice.merchant, payer);
        emit InvoicePaymentSplit(
            invoiceId,
            FHE.toBytes32(_settledAmounts[invoiceId]),
            FHE.toBytes32(_platformFeeAmounts[invoiceId])
        );
    }

    function expireInvoice(uint256 invoiceId) external onlyInvoiceMerchant(invoiceId) {
        Invoice storage invoice = invoices[invoiceId];
        require(invoice.paymentTruth == PaymentTruth.PendingPayment, "invoice not pending");
        require(block.timestamp > invoice.expiresAt, "invoice still active");

        invoice.paymentTruth = PaymentTruth.Expired;
        emit InvoiceExpired(invoiceId);
    }

    function settledAmountOf(uint256 invoiceId) external view returns (euint64) {
        return _settledAmounts[invoiceId];
    }

    function settledAmountHandleOf(uint256 invoiceId) external view returns (bytes32) {
        return FHE.toBytes32(_settledAmounts[invoiceId]);
    }

    function paymentCheckHandleOf(uint256 invoiceId) external view returns (bytes32) {
        return FHE.toBytes32(_paymentChecks[invoiceId]);
    }

    function platformFeeAmountOf(uint256 invoiceId) external view returns (euint64) {
        return _platformFeeAmounts[invoiceId];
    }

    function platformFeeAmountHandleOf(uint256 invoiceId) external view returns (bytes32) {
        return FHE.toBytes32(_platformFeeAmounts[invoiceId]);
    }
}
