// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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

    address public immutable withdrawAuthorizer;
    address public immutable platformFeeWallet;
    bytes32 private immutable cachedDomainSeparator;
    uint256 private immutable cachedChainId;
    bool private locked;

    struct PaymentReceipt {
        address payer;
        address token;
        bytes32 projectId;
        uint256 grossAmount;
        uint256 merchantNetAmount;
        uint256 platformFeeAmount;
        uint256 paidAt;
    }

    mapping(bytes32 => PaymentReceipt) public payments;
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
        require(!locked, "reentrant");
        locked = true;
        _;
        locked = false;
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
        require(intentId != bytes32(0), "intent required");
        require(projectId != bytes32(0), "project required");
        require(token != address(0), "token required");
        require(grossAmount > 0, "amount required");
        require(merchantNetAmount + platformFeeAmount == grossAmount, "split mismatch");
        require(block.timestamp <= expiresAt, "intent expired");
        require(payments[intentId].paidAt == 0, "intent paid");

        payments[intentId] = PaymentReceipt({
            payer: msg.sender,
            token: token,
            projectId: projectId,
            grossAmount: grossAmount,
            merchantNetAmount: merchantNetAmount,
            platformFeeAmount: platformFeeAmount,
            paidAt: block.timestamp
        });
        merchantBalanceOf[projectId][token] += merchantNetAmount;
        platformBalanceOf[token] += platformFeeAmount;

        _safeTokenCall(
            token,
            abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), grossAmount)),
            "transferFrom failed"
        );

        emit EvmPaymentAccepted(
            intentId,
            projectId,
            msg.sender,
            token,
            grossAmount,
            merchantNetAmount,
            platformFeeAmount
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

    function _safeTokenCall(address token, bytes memory data, string memory message) private {
        (bool ok, bytes memory result) = token.call(data);
        require(ok, message);
        if (result.length > 0) {
            require(abi.decode(result, (bool)), message);
        }
    }
}
