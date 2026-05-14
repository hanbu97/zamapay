use shared::{
    EvmChain, EvmChainToken, EvmReceiverAddress, EvmRpcNode, EvmRpcNodeKind, ReceiverAddressStatus,
};

use crate::pg_store::PortalRecordSet;

const LOCAL_CHAIN_ID: u64 = 31_337;
const DEFAULT_LOCAL_RPC_URL: &str = "http://127.0.0.1:8545";
const DEFAULT_LOCAL_SETTLEMENT: &str = "0x00000000000000000000000000000000000000f1";
const DEFAULT_LOCAL_USDT: &str = "0x0000000000000000000000000000000000001001";
const DEFAULT_LOCAL_USDC: &str = "0x0000000000000000000000000000000000001002";

pub(crate) fn seed_evm_catalog(records: &mut PortalRecordSet) {
    if records.evm_chains.is_empty() {
        for chain in default_chains() {
            records.evm_chains.insert(chain.chain_id, chain);
        }
    }

    if records.evm_chain_tokens.is_empty() {
        for token in default_tokens() {
            records
                .evm_chain_tokens
                .insert(token.token_id.clone(), token);
        }
    }

    if records.evm_rpc_nodes.is_empty() {
        for node in default_rpc_nodes() {
            records.evm_rpc_nodes.insert(node.rpc_node_id.clone(), node);
        }
    }

    if records.evm_receiver_addresses.is_empty() {
        for receiver in default_receivers() {
            records
                .evm_receiver_addresses
                .insert(receiver.receiver_id.clone(), receiver);
        }
    }
}

fn default_chains() -> Vec<EvmChain> {
    vec![
        EvmChain {
            chain_id: LOCAL_CHAIN_ID,
            network: "hardhat-local".to_string(),
            name: "Hardhat Local".to_string(),
            native_symbol: "ETH".to_string(),
            finality_threshold: 1,
            enabled: true,
        },
        EvmChain {
            chain_id: 1,
            network: "ethereum".to_string(),
            name: "Ethereum".to_string(),
            native_symbol: "ETH".to_string(),
            finality_threshold: 3,
            enabled: true,
        },
        EvmChain {
            chain_id: 56,
            network: "bsc".to_string(),
            name: "BSC".to_string(),
            native_symbol: "BNB".to_string(),
            finality_threshold: 3,
            enabled: true,
        },
        EvmChain {
            chain_id: 137,
            network: "polygon".to_string(),
            name: "Polygon".to_string(),
            native_symbol: "POL".to_string(),
            finality_threshold: 3,
            enabled: true,
        },
        EvmChain {
            chain_id: 9_745,
            network: "plasma".to_string(),
            name: "Plasma".to_string(),
            native_symbol: "XPL".to_string(),
            finality_threshold: 1,
            enabled: true,
        },
    ]
}

fn default_tokens() -> Vec<EvmChainToken> {
    vec![
        token(
            LOCAL_CHAIN_ID,
            "hardhat-local",
            "USDT",
            local_usdt_contract(),
            6,
        ),
        token(
            LOCAL_CHAIN_ID,
            "hardhat-local",
            "USDC",
            local_usdc_contract(),
            6,
        ),
        token(
            1,
            "ethereum",
            "USDT",
            "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            6,
        ),
        token(
            1,
            "ethereum",
            "USDC",
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            6,
        ),
        token(
            56,
            "bsc",
            "USDT",
            "0x55d398326f99059fF775485246999027B3197955",
            18,
        ),
        token(
            56,
            "bsc",
            "USDC",
            "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
            18,
        ),
        token(
            137,
            "polygon",
            "USDT",
            "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
            6,
        ),
        token(
            137,
            "polygon",
            "USDC",
            "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            6,
        ),
        token(
            9_745,
            "plasma",
            "USDT",
            "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
            6,
        ),
    ]
}

fn token(
    chain_id: u64,
    network: &str,
    symbol: &str,
    contract_address: impl Into<String>,
    decimals: u8,
) -> EvmChainToken {
    EvmChainToken {
        token_id: format!("tok_{chain_id}_{}", symbol.to_ascii_lowercase()),
        chain_id,
        network: network.to_string(),
        symbol: symbol.to_string(),
        contract_address: contract_address.into(),
        decimals,
        min_amount_minor_units: 1,
        enabled: true,
    }
}

fn default_rpc_nodes() -> Vec<EvmRpcNode> {
    vec![
        rpc(
            "hardhat-local",
            LOCAL_CHAIN_ID,
            local_rpc_url(),
            EvmRpcNodeKind::Http,
        ),
        rpc(
            "ethereum",
            1,
            "wss://ethereum.publicnode.com",
            EvmRpcNodeKind::WebSocket,
        ),
        rpc("bsc", 56, "wss://bsc.drpc.org", EvmRpcNodeKind::WebSocket),
        rpc(
            "polygon",
            137,
            "wss://polygon-bor-rpc.publicnode.com",
            EvmRpcNodeKind::WebSocket,
        ),
        rpc(
            "plasma",
            9_745,
            "wss://rpc.plasma.to",
            EvmRpcNodeKind::WebSocket,
        ),
    ]
}

fn rpc(network: &str, chain_id: u64, url: impl Into<String>, kind: EvmRpcNodeKind) -> EvmRpcNode {
    EvmRpcNode {
        rpc_node_id: format!("rpc_{chain_id}_0"),
        chain_id,
        network: network.to_string(),
        url: url.into(),
        kind,
        enabled: true,
    }
}

fn default_receivers() -> Vec<EvmReceiverAddress> {
    let local_settlement = std::env::var("ZAMAPAY_LOCAL_EVM_SETTLEMENT_CONTRACT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(local_manifest_evm_settlement_contract)
        .unwrap_or_else(|| DEFAULT_LOCAL_SETTLEMENT.to_string());
    let mut receivers = vec![receiver(
        "hardhat-local",
        LOCAL_CHAIN_ID,
        0,
        local_settlement,
    )];
    if let Some(public_settlement) = std::env::var("ZAMAPAY_EVM_SETTLEMENT_CONTRACT")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        receivers.extend([
            receiver("ethereum", 1, 0, public_settlement.clone()),
            receiver("bsc", 56, 0, public_settlement.clone()),
            receiver("polygon", 137, 0, public_settlement.clone()),
            receiver("plasma", 9_745, 0, public_settlement),
        ]);
    }
    receivers
}

fn receiver(
    network: &str,
    chain_id: u64,
    slot: u64,
    address: impl Into<String>,
) -> EvmReceiverAddress {
    EvmReceiverAddress {
        receiver_id: format!("recv_{chain_id}_{slot}"),
        chain_id,
        network: network.to_string(),
        address: address.into(),
        status: ReceiverAddressStatus::Active,
    }
}

fn local_rpc_url() -> String {
    std::env::var("ZAMAPAY_LOCAL_EVM_RPC_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_LOCAL_RPC_URL.to_string())
}

fn local_usdt_contract() -> String {
    std::env::var("ZAMAPAY_LOCAL_EVM_USDT_CONTRACT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| local_manifest_erc20_contract("USDT"))
        .unwrap_or_else(|| DEFAULT_LOCAL_USDT.to_string())
}

fn local_usdc_contract() -> String {
    std::env::var("ZAMAPAY_LOCAL_EVM_USDC_CONTRACT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| local_manifest_erc20_contract("USDC"))
        .unwrap_or_else(|| DEFAULT_LOCAL_USDC.to_string())
}

fn local_manifest_erc20_contract(symbol: &str) -> Option<String> {
    shared::local_dev_contract_manifest()
        .ok()?
        .standard_erc20_tokens
        .into_iter()
        .find(|token| {
            token
                .symbol
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case(symbol))
        })?
        .contract
        .filter(|address| !address.trim().is_empty())
}

fn local_manifest_evm_settlement_contract() -> Option<String> {
    shared::local_dev_contract_manifest()
        .ok()?
        .contracts
        .evm_checkout_settlement
        .filter(|address| !address.trim().is_empty())
}
