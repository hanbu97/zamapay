// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./EvmCheckoutSettlement.sol";
import "./StandardERC20Mock.sol";

contract Permit2SignatureTransferMock {
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Permit2");
    bytes32 private constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    string private constant PERMIT_TRANSFER_FROM_WITNESS_STUB =
        "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";
    uint256 private constant SECP256K1_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;
    bytes32 public lastWitness;
    bytes32 public lastWitnessTypeHash;

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    function permitWitnessTransferFrom(
        Permit2TransferPermit calldata permit,
        Permit2TransferDetails calldata transferDetails,
        address owner,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) external {
        require(owner != address(0), "owner required");
        require(block.timestamp <= permit.deadline, "permit2 expired");
        require(transferDetails.to != address(0), "recipient required");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "requested too high");
        _useUnorderedNonce(owner, permit.nonce);

        lastWitness = witness;
        lastWitnessTypeHash = keccak256(bytes(witnessTypeString));
        require(
            _recoverPermitSigner(permit, witness, witnessTypeString, signature) == owner,
            "invalid permit2 signature"
        );
        require(
            StandardERC20Mock(permit.permitted.token).transferFrom(owner, transferDetails.to, transferDetails.requestedAmount),
            "permit2 transfer failed"
        );
    }

    function _useUnorderedNonce(address owner, uint256 nonce) private {
        uint256 wordPos = nonce >> 8;
        uint256 bit = 1 << (nonce & 255);
        uint256 word = nonceBitmap[owner][wordPos];
        require((word & bit) == 0, "nonce used");
        nonceBitmap[owner][wordPos] = word | bit;
    }

    function _recoverPermitSigner(
        Permit2TransferPermit calldata permit,
        bytes32 witness,
        string calldata witnessTypeString,
        bytes calldata signature
    ) private view returns (address) {
        require(signature.length == 65, "bad signature length");
        bytes32 tokenPermissionsHash =
            keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
        bytes32 typeHash = keccak256(abi.encodePacked(PERMIT_TRANSFER_FROM_WITNESS_STUB, witnessTypeString));
        bytes32 structHash = keccak256(
            abi.encode(typeHash, tokenPermissionsHash, msg.sender, permit.nonce, permit.deadline, witness)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
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
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad signature");
        return signer;
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, block.chainid, address(this)));
    }
}

contract ShortTransferERC20Mock {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public immutable owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals) {
        name = tokenName;
        symbol = tokenSymbol;
        decimals = tokenDecimals;
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _shortTransfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "allowance too low");
        allowance[from][msg.sender] = currentAllowance - amount;
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        _shortTransfer(from, to, amount);
        return true;
    }

    function _shortTransfer(address from, address to, uint256 amount) private {
        require(to != address(0), "to required");
        require(amount > 1, "amount too low");
        require(balanceOf[from] >= amount, "balance too low");
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        totalSupply -= 1;
        emit Transfer(from, to, amount - 1);
    }
}
