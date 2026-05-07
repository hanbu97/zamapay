// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, ebool, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IMerchantRegistry {
    function isMerchant(address merchant) external view returns (bool);
    function payoutWalletOf(address merchant) external view returns (address);
}

interface IConfidentialUSD {
    function transferFromExact(
        address from,
        address to,
        euint64 amount,
        uint64 expectedAmount
    ) external returns (ebool);
}

contract ConfidentialInvoiceSettlement is ZamaEthereumConfig {
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
        PaymentTruth paymentTruth;
        address payer;
        uint256 paidAt;
    }

    IMerchantRegistry public immutable merchantRegistry;
    IConfidentialUSD public immutable settlementToken;
    uint256 public invoiceCount;

    mapping(uint256 => Invoice) public invoices;
    mapping(uint256 => euint64) private _settledAmounts;
    mapping(uint256 => ebool) private _paymentChecks;

    event InvoiceCreated(
        uint256 indexed invoiceId,
        address indexed merchant,
        string externalRef,
        uint256 expiresAt,
        uint64 amountDue
    );
    event InvoicePaymentSubmitted(
        uint256 indexed invoiceId,
        address indexed merchant,
        address indexed payer,
        bytes32 paymentCheckHandle
    );
    event InvoicePaymentRejected(uint256 indexed invoiceId, address indexed merchant, address indexed payer);
    event InvoicePaid(uint256 indexed invoiceId, address indexed merchant, address indexed payer);
    event InvoiceExpired(uint256 indexed invoiceId);

    modifier onlyRegisteredMerchant() {
        require(merchantRegistry.isMerchant(msg.sender), "merchant not registered");
        _;
    }

    modifier onlyInvoiceMerchant(uint256 invoiceId) {
        require(invoices[invoiceId].merchant == msg.sender, "not invoice merchant");
        _;
    }

    constructor(address merchantRegistryAddress, address settlementTokenAddress) {
        require(merchantRegistryAddress != address(0), "merchant registry required");
        require(settlementTokenAddress != address(0), "settlement token required");
        merchantRegistry = IMerchantRegistry(merchantRegistryAddress);
        settlementToken = IConfidentialUSD(settlementTokenAddress);
    }

    function createInvoice(
        string calldata externalRef,
        uint256 expiresAt,
        uint64 amountDue
    ) external onlyRegisteredMerchant returns (uint256) {
        require(expiresAt > block.timestamp, "expiry must be in future");
        require(amountDue > 0, "amount due required");

        uint256 invoiceId = invoiceCount++;
        address payoutWallet = merchantRegistry.payoutWalletOf(msg.sender);

        invoices[invoiceId] = Invoice({
            id: invoiceId,
            merchant: msg.sender,
            payoutWallet: payoutWallet,
            externalRef: externalRef,
            expiresAt: expiresAt,
            amountDue: amountDue,
            paymentTruth: PaymentTruth.PendingPayment,
            payer: address(0),
            paidAt: 0
        });

        _settledAmounts[invoiceId] = FHE.asEuint64(0);
        FHE.allowThis(_settledAmounts[invoiceId]);
        FHE.allow(_settledAmounts[invoiceId], msg.sender);
        FHE.allow(_settledAmounts[invoiceId], payoutWallet);

        emit InvoiceCreated(invoiceId, msg.sender, externalRef, expiresAt, amountDue);
        return invoiceId;
    }

    function payInvoice(uint256 invoiceId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        Invoice storage invoice = invoices[invoiceId];
        require(invoice.merchant != address(0), "invoice not found");
        require(invoice.paymentTruth == PaymentTruth.PendingPayment, "invoice not payable");
        require(block.timestamp <= invoice.expiresAt, "invoice expired");

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, address(settlementToken));

        ebool accepted = settlementToken.transferFromExact(
            msg.sender,
            invoice.payoutWallet,
            amount,
            invoice.amountDue
        );
        FHE.allowThis(accepted);
        FHE.makePubliclyDecryptable(accepted);

        euint64 settledAmount = FHE.select(accepted, FHE.asEuint64(invoice.amountDue), FHE.asEuint64(0));
        FHE.allowThis(settledAmount);
        FHE.allow(settledAmount, invoice.merchant);
        FHE.allow(settledAmount, invoice.payoutWallet);

        euint64 nextSettledAmount = FHE.add(_settledAmounts[invoiceId], settledAmount);
        FHE.allowThis(nextSettledAmount);
        FHE.allow(nextSettledAmount, msg.sender);
        FHE.allow(nextSettledAmount, invoice.merchant);
        FHE.allow(nextSettledAmount, invoice.payoutWallet);

        _paymentChecks[invoiceId] = accepted;
        _settledAmounts[invoiceId] = nextSettledAmount;
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
}
