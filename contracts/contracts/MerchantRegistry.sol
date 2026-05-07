// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MerchantRegistry {
    struct Merchant {
        bool active;
        address payoutWallet;
        string label;
        uint256 createdAt;
    }

    mapping(address => Merchant) private _merchants;

    event MerchantRegistered(address indexed merchant, address indexed payoutWallet, string label);
    event MerchantPayoutWalletUpdated(address indexed merchant, address indexed payoutWallet);

    modifier onlyRegisteredMerchant() {
        require(_merchants[msg.sender].active, "merchant not registered");
        _;
    }

    function registerMerchant(address payoutWallet, string calldata label) external {
        require(!_merchants[msg.sender].active, "merchant already registered");
        require(payoutWallet != address(0), "payout wallet required");

        _merchants[msg.sender] = Merchant({
            active: true,
            payoutWallet: payoutWallet,
            label: label,
            createdAt: block.timestamp
        });

        emit MerchantRegistered(msg.sender, payoutWallet, label);
    }

    function updatePayoutWallet(address payoutWallet) external onlyRegisteredMerchant {
        require(payoutWallet != address(0), "payout wallet required");
        _merchants[msg.sender].payoutWallet = payoutWallet;
        emit MerchantPayoutWalletUpdated(msg.sender, payoutWallet);
    }

    function isMerchant(address merchant) external view returns (bool) {
        return _merchants[merchant].active;
    }

    function payoutWalletOf(address merchant) external view returns (address) {
        return _merchants[merchant].payoutWallet;
    }

    function merchantOf(address merchant) external view returns (Merchant memory) {
        return _merchants[merchant];
    }
}
