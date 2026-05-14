use std::collections::HashMap;

use chrono::{DateTime, Utc};
use domain::{FinalityStatus, PaymentTruth};
use shared::{
    EvmChain, EvmChainToken, EvmPaymentIntent, EvmPaymentIntentStatus, EvmReceiverAddress,
    EvmRpcNode, EvmTransferProjectionRequest, EvmTransferStatus, ReceiverAddressStatus,
    SupportedEvmAsset,
};

pub(crate) fn transfer_id(payload: &EvmTransferProjectionRequest) -> String {
    format!(
        "evm_{}_{}_{}_{}",
        payload.chain_id,
        normalize_hex(&payload.settlement_contract),
        normalize_hex(&payload.tx_hash),
        payload.log_index
    )
}

pub(crate) fn transfer_status(confirmations: u64, threshold: u64) -> EvmTransferStatus {
    if confirmations >= threshold {
        EvmTransferStatus::Confirmed
    } else {
        EvmTransferStatus::Detected
    }
}

pub(crate) fn supported_asset(
    chain: &EvmChain,
    token: &EvmChainToken,
    rpc_node: &EvmRpcNode,
    receiver: &EvmReceiverAddress,
) -> SupportedEvmAsset {
    SupportedEvmAsset {
        receiver_id: receiver.receiver_id.clone(),
        chain_id: chain.chain_id,
        network: chain.network.clone(),
        chain_name: chain.name.clone(),
        native_symbol: chain.native_symbol.clone(),
        token_symbol: token.symbol.clone(),
        token_contract: token.contract_address.clone(),
        token_decimals: token.decimals,
        min_amount_minor_units: token.min_amount_minor_units,
        finality_threshold: chain.finality_threshold,
        rpc_url: rpc_node.url.clone(),
        receiver_address: receiver.address.clone(),
        settlement_contract: receiver.address.clone(),
    }
}

pub(crate) fn intent_supported_asset(
    intent: &EvmPaymentIntent,
    chains: &HashMap<u64, EvmChain>,
    tokens: &HashMap<String, EvmChainToken>,
    rpc_nodes: &HashMap<String, EvmRpcNode>,
    receivers: &HashMap<String, EvmReceiverAddress>,
) -> Option<SupportedEvmAsset> {
    let chain = chains.get(&intent.chain_id).filter(|chain| chain.enabled)?;
    let token = tokens.values().find(|token| {
        token.chain_id == intent.chain_id
            && token.enabled
            && token
                .contract_address
                .eq_ignore_ascii_case(&intent.token_contract)
    })?;
    let rpc_node = rpc_nodes
        .values()
        .filter(|node| node.chain_id == intent.chain_id && node.enabled)
        .min_by_key(|node| node.rpc_node_id.as_str())?;
    let receiver = receivers
        .get(&intent.receiver_id)
        .filter(|receiver| receiver.status == ReceiverAddressStatus::Active)?;

    Some(supported_asset(chain, token, rpc_node, receiver))
}

pub(crate) fn open_intent(intent: &EvmPaymentIntent, now: DateTime<Utc>) -> bool {
    matches!(
        intent.status,
        EvmPaymentIntentStatus::RequiresPayment | EvmPaymentIntentStatus::Detected
    ) && intent.expires_at > now
}

pub(crate) fn intent_status_from_transfer(
    transfer_status: EvmTransferStatus,
    confirmations: u64,
    finality_threshold: u64,
) -> EvmPaymentIntentStatus {
    match transfer_status {
        EvmTransferStatus::Confirmed => EvmPaymentIntentStatus::Confirmed,
        EvmTransferStatus::Detected => {
            if confirmations >= finality_threshold {
                EvmPaymentIntentStatus::Confirmed
            } else {
                EvmPaymentIntentStatus::Detected
            }
        }
        EvmTransferStatus::Underpaid => EvmPaymentIntentStatus::Underpaid,
        EvmTransferStatus::Overpaid => EvmPaymentIntentStatus::Overpaid,
        EvmTransferStatus::Expired => EvmPaymentIntentStatus::Expired,
        EvmTransferStatus::Reorged => EvmPaymentIntentStatus::Failed,
        EvmTransferStatus::Duplicate | EvmTransferStatus::Ignored => EvmPaymentIntentStatus::Failed,
    }
}

pub(crate) fn payment_truth_for_evm_intent(status: EvmPaymentIntentStatus) -> PaymentTruth {
    match status {
        EvmPaymentIntentStatus::Detected | EvmPaymentIntentStatus::Confirmed => PaymentTruth::Paid,
        EvmPaymentIntentStatus::Expired => PaymentTruth::Expired,
        EvmPaymentIntentStatus::Failed => PaymentTruth::Failed,
        _ => PaymentTruth::PendingPayment,
    }
}

pub(crate) fn finality_for_evm_intent(
    status: EvmPaymentIntentStatus,
    confirmations: u64,
) -> FinalityStatus {
    match status {
        EvmPaymentIntentStatus::Confirmed => FinalityStatus::FinalitySafe,
        EvmPaymentIntentStatus::Detected if confirmations == 0 => FinalityStatus::Indexing,
        EvmPaymentIntentStatus::Detected => FinalityStatus::AwaitingFinality,
        EvmPaymentIntentStatus::Failed => FinalityStatus::ReorgException,
        _ => FinalityStatus::NotPaid,
    }
}

pub(crate) fn block_hash_conflicts(existing: Option<&str>, incoming: Option<&str>) -> bool {
    matches!(
        (existing, incoming),
        (Some(existing), Some(incoming)) if !existing.eq_ignore_ascii_case(incoming)
    )
}

pub(crate) fn cursor_id(chain_id: u64, settlement_contract: &str) -> String {
    format!("cur_{}_{}", chain_id, normalize_hex(settlement_contract))
}

pub(crate) fn asset_balance_key(chain_id: u64, token_contract: &str) -> String {
    format!("{chain_id}:{}", normalize_hex(token_contract))
}

fn normalize_hex(value: &str) -> String {
    value.trim().trim_start_matches("0x").to_ascii_lowercase()
}
