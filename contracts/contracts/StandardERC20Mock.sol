// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract StandardERC20Mock {
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
        require(to != address(0), "to required");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function claimTestTokens() external returns (uint256) {
        uint256 amount = 1000 * (10 ** uint256(decimals));
        totalSupply += amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(0), msg.sender, amount);
        return amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        require(spender != address(0), "spender required");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "allowance too low");
        allowance[from][msg.sender] = currentAllowance - amount;
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(to != address(0), "to required");
        require(balanceOf[from] >= amount, "balance too low");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
