// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract SubscriptionPass {
    string public constant name = "ZamaPay Subscription Pass";
    string public constant symbol = "MSP";

    address public owner;
    address public minter;
    uint256 public totalSupply;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event MinterUpdated(address indexed minter);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "not minter");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setMinter(address nextMinter) external onlyOwner {
        require(nextMinter != address(0), "minter required");
        minter = nextMinter;
        emit MinterUpdated(nextMinter);
    }

    function mint(address to) external onlyMinter returns (uint256) {
        require(to != address(0), "recipient required");
        uint256 tokenId = ++totalSupply;
        _owners[tokenId] = to;
        _balances[to] += 1;
        emit Transfer(address(0), to, tokenId);
        return tokenId;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "pass not found");
        return tokenOwner;
    }

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "account required");
        return _balances[account];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return "ipfs://zamapay-subscription-pass";
    }

    function approve(address, uint256) external pure {
        revert("subscription pass is soulbound");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("subscription pass is soulbound");
    }

    function transferFrom(address, address, uint256) external pure {
        revert("subscription pass is soulbound");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("subscription pass is soulbound");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("subscription pass is soulbound");
    }
}
