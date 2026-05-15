// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20PermitLike {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IEip3009Like {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

struct Permit2TokenPermissions {
    address token;
    uint256 amount;
}

struct Permit2TransferPermit {
    Permit2TokenPermissions permitted;
    uint256 nonce;
    uint256 deadline;
}

struct Permit2TransferDetails {
    address to;
    uint256 requestedAmount;
}

interface IPermit2SignatureTransfer {
    function permitWitnessTransferFrom(
        Permit2TransferPermit calldata permit,
        Permit2TransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external;
}

contract EvmCheckoutSettlement {
    bytes32 private constant WITHDRAW_TYPEHASH =
        keccak256("EvmWithdraw(bytes32 projectId,address token,address recipient,uint256 amount,bytes32 withdrawalId,uint256 deadline)");
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256(bytes("ZamaPayEvmCheckoutSettlement"));
    bytes32 private constant VERSION_HASH = keccak256(bytes("1"));
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    bytes32 public constant PAYMENT_AUTHORIZATION_TYPEHASH = keccak256(
        "ZamaPayEvmPayment(bytes32 intentId,bytes32 projectId,address payer,address token,uint256 grossAmount,uint256 merchantNetAmount,uint256 platformFeeAmount,address settlement,uint256 chainId,uint256 deadline)"
    );
    string public constant PERMIT2_PAYMENT_WITNESS_TYPE_STRING =
        "ZamaPayEvmPayment witness)TokenPermissions(address token,uint256 amount)ZamaPayEvmPayment(bytes32 intentId,bytes32 projectId,address payer,address token,uint256 grossAmount,uint256 merchantNetAmount,uint256 platformFeeAmount,address settlement,uint256 chainId,uint256 deadline)";

    address public immutable withdrawAuthorizer;
    address public immutable platformFeeWallet;
    bytes32 private immutable cachedDomainSeparator;
    uint256 private immutable cachedChainId;
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;
    uint256 private locked = NOT_ENTERED;

    struct PaymentParams {
        bytes32 intentId;
        bytes32 projectId;
        address token;
        uint256 grossAmount;
        uint256 merchantNetAmount;
        uint256 platformFeeAmount;
        uint256 expiresAt;
    }

    struct Eip3009Authorization {
        address payer;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Permit2Payment {
        address permit2;
        address payer;
        Permit2TransferPermit permit;
        bytes32 witness;
        string witnessTypeString;
        bytes signature;
    }

    struct Erc2612Permit {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    mapping(bytes32 => bool) public acceptedIntent;
    mapping(bytes32 => mapping(address => uint256)) public merchantBalanceOf;
    mapping(address => uint256) public platformBalanceOf;
    mapping(bytes32 => bool) public withdrawalUsed;

    event EvmPaymentAccepted(
        bytes32 indexed intentId,
        bytes32 indexed projectId,
        address indexed payer,
        address token,
        uint256 grossAmount,
        uint256 merchantNetAmount,
        uint256 platformFeeAmount
    );
    event EvmMerchantWithdrawn(
        bytes32 indexed projectId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 withdrawalId
    );
    event EvmPlatformFeeWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        require(locked != ENTERED, "reentrant");
        locked = ENTERED;
        _;
        locked = NOT_ENTERED;
    }

    constructor(address initialWithdrawAuthorizer, address initialPlatformFeeWallet) {
        require(initialWithdrawAuthorizer != address(0), "authorizer required");
        require(initialPlatformFeeWallet != address(0), "fee wallet required");
        withdrawAuthorizer = initialWithdrawAuthorizer;
        platformFeeWallet = initialPlatformFeeWallet;
        cachedChainId = block.chainid;
        cachedDomainSeparator = _buildDomainSeparator();
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator();
    }

    function pay(
        bytes32 intentId,
        bytes32 projectId,
        address token,
        uint256 grossAmount,
        uint256 merchantNetAmount,
        uint256 platformFeeAmount,
        uint256 expiresAt
    ) external nonReentrant {
        _prevalidatePayment(
            msg.sender,
            intentId,
            projectId,
            token,
            grossAmount,
            merchantNetAmount,
            platformFeeAmount,
            expiresAt
        );
        uint256 beforeBalance = _tokenBalanceOf(token, address(this));
        _safeTokenCall(
            token,
            abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), grossAmount)),
            "transferFrom failed"
        );
        _assertExactFundingDelta(token, beforeBalance, grossAmount);
        _acceptPayment(
            msg.sender,
            intentId,
            projectId,
            token,
            grossAmount,
            merchantNetAmount,
            platformFeeAmount
        );
    }

    function payWithAuthorization(PaymentParams calldata params, Eip3009Authorization calldata authorization)
        external
        nonReentrant
    {
        _prevalidatePayment(
            authorization.payer,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount,
            params.expiresAt
        );
        require(
            authorization.nonce == _paymentAuthorizationHash(params, authorization.payer, authorization.validBefore),
            "bad authorization nonce"
        );
        require(authorization.validBefore >= block.timestamp, "authorization expired");

        uint256 beforeBalance = _tokenBalanceOf(params.token, address(this));
        IEip3009Like(params.token).receiveWithAuthorization(
            authorization.payer,
            address(this),
            params.grossAmount,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            authorization.v,
            authorization.r,
            authorization.s
        );
        _assertExactFundingDelta(params.token, beforeBalance, params.grossAmount);
        _acceptPayment(
            authorization.payer,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount
        );
    }

    function payWithPermit2(PaymentParams calldata params, Permit2Payment calldata permit2Payment) external nonReentrant {
        _prevalidatePayment(
            permit2Payment.payer,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount,
            params.expiresAt
        );
        require(permit2Payment.permit2 != address(0), "permit2 required");
        require(permit2Payment.permit.permitted.token == params.token, "permit2 token mismatch");
        require(permit2Payment.permit.permitted.amount == params.grossAmount, "permit2 amount mismatch");
        require(permit2Payment.permit.deadline >= block.timestamp, "permit2 expired");
        require(
            permit2Payment.witness == _paymentAuthorizationHash(params, permit2Payment.payer, permit2Payment.permit.deadline),
            "bad permit2 witness"
        );
        require(
            keccak256(bytes(permit2Payment.witnessTypeString)) == keccak256(bytes(PERMIT2_PAYMENT_WITNESS_TYPE_STRING)),
            "bad permit2 witness type"
        );

        uint256 beforeBalance = _tokenBalanceOf(params.token, address(this));
        IPermit2SignatureTransfer(permit2Payment.permit2).permitWitnessTransferFrom(
            permit2Payment.permit,
            Permit2TransferDetails({to: address(this), requestedAmount: params.grossAmount}),
            permit2Payment.payer,
            permit2Payment.witness,
            permit2Payment.witnessTypeString,
            permit2Payment.signature
        );
        _assertExactFundingDelta(params.token, beforeBalance, params.grossAmount);
        _acceptPayment(
            permit2Payment.payer,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount
        );
    }

    function payWithPermit(PaymentParams calldata params, Erc2612Permit calldata permit) external nonReentrant {
        _prevalidatePayment(
            msg.sender,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount,
            params.expiresAt
        );
        require(permit.deadline >= block.timestamp, "permit expired");

        uint256 beforeBalance = _tokenBalanceOf(params.token, address(this));
        IERC20PermitLike(params.token).permit(
            msg.sender,
            address(this),
            params.grossAmount,
            permit.deadline,
            permit.v,
            permit.r,
            permit.s
        );
        _safeTokenCall(
            params.token,
            abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), params.grossAmount)),
            "transferFrom failed"
        );
        _assertExactFundingDelta(params.token, beforeBalance, params.grossAmount);
        _acceptPayment(
            msg.sender,
            params.intentId,
            params.projectId,
            params.token,
            params.grossAmount,
            params.merchantNetAmount,
            params.platformFeeAmount
        );
    }

    function paymentAuthorizationHash(PaymentParams calldata params, address payer, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _paymentAuthorizationHash(params, payer, deadline);
    }

    function _paymentAuthorizationHash(PaymentParams calldata params, address payer, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PAYMENT_AUTHORIZATION_TYPEHASH,
                params.intentId,
                params.projectId,
                payer,
                params.token,
                params.grossAmount,
                params.merchantNetAmount,
                params.platformFeeAmount,
                address(this),
                block.chainid,
                deadline
            )
        );
    }

    function withdrawMerchant(
        bytes32 projectId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 withdrawalId,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        require(projectId != bytes32(0), "project required");
        require(token != address(0), "token required");
        require(recipient != address(0), "recipient required");
        require(amount > 0, "amount required");
        require(withdrawalId != bytes32(0), "withdrawal required");
        require(block.timestamp <= deadline, "withdraw expired");
        require(!withdrawalUsed[withdrawalId], "withdraw used");
        require(_recoverWithdrawSigner(projectId, token, recipient, amount, withdrawalId, deadline, signature) == withdrawAuthorizer, "bad signature");

        withdrawalUsed[withdrawalId] = true;
        uint256 balance = merchantBalanceOf[projectId][token];
        require(balance >= amount, "balance too low");
        merchantBalanceOf[projectId][token] = balance - amount;

        _safeTokenCall(token, abi.encodeCall(IERC20Like.transfer, (recipient, amount)), "transfer failed");

        emit EvmMerchantWithdrawn(projectId, token, recipient, amount, withdrawalId);
    }

    function withdrawPlatformFee(address token, address recipient, uint256 amount) external nonReentrant {
        require(msg.sender == platformFeeWallet, "fee wallet only");
        require(token != address(0), "token required");
        require(recipient != address(0), "recipient required");
        require(amount > 0, "amount required");
        uint256 balance = platformBalanceOf[token];
        require(balance >= amount, "balance too low");
        platformBalanceOf[token] = balance - amount;

        _safeTokenCall(token, abi.encodeCall(IERC20Like.transfer, (recipient, amount)), "transfer failed");

        emit EvmPlatformFeeWithdrawn(token, recipient, amount);
    }

    function withdrawDigest(
        bytes32 projectId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 withdrawalId,
        uint256 deadline
    ) external view returns (bytes32) {
        return _withdrawDigest(projectId, token, recipient, amount, withdrawalId, deadline);
    }

    function _withdrawDigest(
        bytes32 projectId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 withdrawalId,
        uint256 deadline
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(WITHDRAW_TYPEHASH, projectId, token, recipient, amount, withdrawalId, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }

    function _recoverWithdrawSigner(
        bytes32 projectId,
        address token,
        address recipient,
        uint256 amount,
        bytes32 withdrawalId,
        uint256 deadline,
        bytes calldata signature
    ) private view returns (address) {
        require(signature.length == 65, "bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(v == 27 || v == 28, "bad signature v");
        require(uint256(s) <= SECP256K1_HALF_ORDER, "bad signature s");
        address signer = ecrecover(_withdrawDigest(projectId, token, recipient, amount, withdrawalId, deadline), v, r, s);
        require(signer != address(0), "bad signature");
        return signer;
    }

    function _domainSeparator() private view returns (bytes32) {
        return block.chainid == cachedChainId ? cachedDomainSeparator : _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _prevalidatePayment(
        address payer,
        bytes32 intentId,
        bytes32 projectId,
        address token,
        uint256 grossAmount,
        uint256 merchantNetAmount,
        uint256 platformFeeAmount,
        uint256 expiresAt
    ) private view {
        require(payer != address(0), "payer required");
        require(intentId != bytes32(0), "intent required");
        require(projectId != bytes32(0), "project required");
        require(token != address(0), "token required");
        require(grossAmount > 0, "amount required");
        require(merchantNetAmount + platformFeeAmount == grossAmount, "split mismatch");
        require(block.timestamp <= expiresAt, "intent expired");
        require(!acceptedIntent[intentId], "intent paid");
    }

    function _assertExactFundingDelta(address token, uint256 beforeBalance, uint256 grossAmount) private view {
        require(_tokenBalanceOf(token, address(this)) == beforeBalance + grossAmount, "funding amount mismatch");
    }

    function _acceptPayment(
        address payer,
        bytes32 intentId,
        bytes32 projectId,
        address token,
        uint256 grossAmount,
        uint256 merchantNetAmount,
        uint256 platformFeeAmount
    ) private {
        acceptedIntent[intentId] = true;
        merchantBalanceOf[projectId][token] += merchantNetAmount;
        platformBalanceOf[token] += platformFeeAmount;

        emit EvmPaymentAccepted(
            intentId,
            projectId,
            payer,
            token,
            grossAmount,
            merchantNetAmount,
            platformFeeAmount
        );
    }

    function _tokenBalanceOf(address token, address account) private view returns (uint256) {
        (bool ok, bytes memory result) = token.staticcall(abi.encodeCall(IERC20Like.balanceOf, (account)));
        require(ok && result.length >= 32, "balanceOf failed");
        return abi.decode(result, (uint256));
    }

    function _safeTokenCall(address token, bytes memory data, string memory message) private {
        (bool ok, bytes memory result) = token.call(data);
        require(ok, message);
        if (result.length > 0) {
            require(abi.decode(result, (bool)), message);
        }
    }
}
