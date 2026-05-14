use chrono::{DateTime, Utc};
use domain::FulfillmentStatus;
use shared::{
    CheckoutSessionStatus, EvmAssetBalance, EvmIndexerCursor, EvmIndexerCursorProjectionRequest,
    EvmIndexerWatchAsset, EvmIndexerWatchlist, EvmPaymentIntent, EvmPaymentIntentStatus,
    EvmTransferLedgerEntry, EvmTransferProjectionRequest, EvmTransferProjectionResponse,
    EvmTransferStatus, PaymentRail, ProjectWithdrawalRecord, PublicCheckoutResponse,
    ReceiverAddressStatus, SupportedEvmAsset,
};
use uuid::Uuid;

use crate::PortalStore;
use crate::project_support::CheckoutSessionError;
use crate::projections::{mark_webhook_pending_if_due, preserve_release_status};

mod catalog;
mod support;

pub(crate) use catalog::seed_evm_catalog;
use support::{
    asset_balance_key, block_hash_conflicts, cursor_id, finality_for_evm_intent,
    intent_status_from_transfer, intent_supported_asset, open_intent, payment_truth_for_evm_intent,
    receiver_is_available, receiver_reuse_delay, reclaim_receiver_if_reusable, supported_asset,
    transfer_id, transfer_status,
};

#[derive(Debug, Clone)]
struct IntentMatch {
    intent_id: String,
    status: EvmTransferStatus,
}

impl PortalStore {
    pub async fn supported_evm_assets(&self) -> Vec<SupportedEvmAsset> {
        let now = Utc::now();
        let chains = self.evm_chains.read().await;
        let tokens = self.evm_chain_tokens.read().await;
        let rpc_nodes = self.evm_rpc_nodes.read().await;
        let receivers = self.evm_receiver_addresses.read().await;

        let mut assets = Vec::new();
        for chain in chains.values().filter(|chain| chain.enabled) {
            let Some(rpc_node) = rpc_nodes
                .values()
                .find(|node| node.chain_id == chain.chain_id && node.enabled)
            else {
                continue;
            };
            let Some(receiver) = receivers.values().find(|receiver| {
                receiver.chain_id == chain.chain_id && receiver_is_available(receiver, now)
            }) else {
                continue;
            };

            for token in tokens.values().filter(|token| {
                token.chain_id == chain.chain_id
                    && token.enabled
                    && !token.contract_address.trim().is_empty()
            }) {
                assets.push(supported_asset(chain, token, rpc_node, receiver));
            }
        }

        assets.sort_by(|left, right| {
            left.network
                .cmp(&right.network)
                .then(left.token_symbol.cmp(&right.token_symbol))
        });
        assets
    }

    pub(crate) async fn reserve_supported_evm_asset(
        &self,
        chain_id: Option<u64>,
        token_symbol: Option<&str>,
        intent_id: &str,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> Result<SupportedEvmAsset, CheckoutSessionError> {
        let requested_symbol = token_symbol.map(|symbol| symbol.trim().to_ascii_uppercase());
        let chains = self.evm_chains.read().await;
        let tokens = self.evm_chain_tokens.read().await;
        let rpc_nodes = self.evm_rpc_nodes.read().await;
        let mut receivers = self.evm_receiver_addresses.write().await;

        for receiver in receivers.values_mut() {
            reclaim_receiver_if_reusable(receiver, now);
        }

        let mut chain_candidates: Vec<_> = chains
            .values()
            .filter(|chain| chain.enabled)
            .filter(|chain| chain_id.is_none_or(|id| chain.chain_id == id))
            .collect();
        chain_candidates.sort_by(|left, right| left.network.cmp(&right.network));

        for chain in chain_candidates {
            let Some(rpc_node) = rpc_nodes
                .values()
                .filter(|node| node.chain_id == chain.chain_id && node.enabled)
                .min_by_key(|node| node.rpc_node_id.as_str())
            else {
                continue;
            };
            let mut token_candidates: Vec<_> = tokens
                .values()
                .filter(|token| token.chain_id == chain.chain_id && token.enabled)
                .filter(|token| !token.contract_address.trim().is_empty())
                .filter(|token| {
                    requested_symbol
                        .as_deref()
                        .is_none_or(|symbol| token.symbol.eq_ignore_ascii_case(symbol))
                })
                .collect();
            token_candidates.sort_by(|left, right| left.symbol.cmp(&right.symbol));

            for token in token_candidates {
                let receiver_id = receivers
                    .values()
                    .filter(|receiver| receiver.chain_id == chain.chain_id)
                    .filter(|receiver| receiver_is_available(receiver, now))
                    .map(|receiver| receiver.receiver_id.clone())
                    .min();
                let Some(receiver_id) = receiver_id else {
                    continue;
                };
                let Some(receiver) = receivers.get_mut(&receiver_id) else {
                    continue;
                };

                receiver.lease_intent_id = Some(intent_id.to_string());
                receiver.leased_until = Some(expires_at);
                receiver.available_after = None;

                return Ok(supported_asset(chain, token, rpc_node, receiver));
            }
        }

        Err(CheckoutSessionError::Locked)
    }

    pub(crate) async fn insert_evm_payment_intent(&self, intent: EvmPaymentIntent) {
        self.evm_payment_intents
            .write()
            .await
            .insert(intent.intent_id.clone(), intent);
    }

    pub async fn evm_payment_intent_by_id(&self, intent_id: &str) -> Option<EvmPaymentIntent> {
        self.evm_payment_intents
            .read()
            .await
            .get(intent_id)
            .cloned()
    }

    pub async fn public_checkout_by_id(&self, checkout_id: &str) -> Option<PublicCheckoutResponse> {
        let invoice = self.invoice_by_id(checkout_id).await?;
        let session = self.checkout_session_by_id(checkout_id).await;
        let evm_payment_intent = match invoice.payment_intent_id.as_deref() {
            Some(intent_id) => self.evm_payment_intent_by_id(intent_id).await,
            None => None,
        };
        let evm_asset = match evm_payment_intent.as_ref() {
            Some(intent) => {
                let chains = self.evm_chains.read().await;
                let tokens = self.evm_chain_tokens.read().await;
                let rpc_nodes = self.evm_rpc_nodes.read().await;
                let receivers = self.evm_receiver_addresses.read().await;
                intent_supported_asset(intent, &chains, &tokens, &rpc_nodes, &receivers)
            }
            None => None,
        };
        let merchant_owner_wallet = match invoice.project_id.as_deref() {
            Some(project_id) => self
                .project_by_id(project_id)
                .await
                .map(|project| project.owner_wallet),
            None => None,
        };

        Some(PublicCheckoutResponse {
            invoice,
            session,
            evm_payment_intent,
            evm_asset,
            merchant_owner_wallet,
        })
    }

    pub async fn evm_indexer_watchlist(&self, now: DateTime<Utc>) -> EvmIndexerWatchlist {
        let intents = self.evm_payment_intents.read().await;
        let chains = self.evm_chains.read().await;
        let tokens = self.evm_chain_tokens.read().await;
        let rpc_nodes = self.evm_rpc_nodes.read().await;
        let receivers = self.evm_receiver_addresses.read().await;
        let cursors = self.evm_indexer_cursors.read().await;

        let mut assets = Vec::new();
        for chain in chains.values().filter(|chain| chain.enabled) {
            let Some(rpc_node) = rpc_nodes
                .values()
                .find(|node| node.chain_id == chain.chain_id && node.enabled)
            else {
                continue;
            };
            for receiver in receivers.values().filter(|receiver| {
                receiver.chain_id == chain.chain_id
                    && receiver.status == ReceiverAddressStatus::Active
            }) {
                for token in tokens.values().filter(|token| {
                    token.chain_id == chain.chain_id
                        && token.enabled
                        && !token.contract_address.trim().is_empty()
                }) {
                    let asset = supported_asset(chain, token, rpc_node, receiver);
                    let open_intent_ids: Vec<String> = intents
                        .values()
                        .filter(|intent| intent.chain_id == asset.chain_id)
                        .filter(|intent| {
                            intent
                                .token_contract
                                .eq_ignore_ascii_case(&asset.token_contract)
                                && intent
                                    .receiver_address
                                    .eq_ignore_ascii_case(&asset.receiver_address)
                        })
                        .filter(|intent| {
                            matches!(
                                intent.status,
                                EvmPaymentIntentStatus::RequiresPayment
                                    | EvmPaymentIntentStatus::Detected
                            ) && intent.expires_at > now
                        })
                        .map(|intent| intent.intent_id.clone())
                        .collect();
                    let cursor = cursors
                        .get(&cursor_id(
                            asset.chain_id,
                            &asset.token_contract,
                            &asset.receiver_address,
                        ))
                        .cloned();

                    if !open_intent_ids.is_empty() {
                        assets.push(EvmIndexerWatchAsset {
                            asset,
                            open_intent_ids,
                            cursor,
                        });
                    }
                }
            }
        }

        EvmIndexerWatchlist { assets }
    }

    pub async fn project_evm_indexer_cursor(
        &self,
        payload: EvmIndexerCursorProjectionRequest,
        now: DateTime<Utc>,
    ) -> EvmIndexerCursor {
        let cursor = EvmIndexerCursor {
            cursor_id: cursor_id(
                payload.chain_id,
                &payload.token_contract,
                &payload.receiver_address,
            ),
            chain_id: payload.chain_id,
            token_contract: payload.token_contract.trim().to_string(),
            receiver_address: payload.receiver_address.trim().to_string(),
            last_scanned_block: payload.last_scanned_block,
            last_finalized_block: payload.last_finalized_block,
            updated_at: now,
        };
        self.evm_indexer_cursors
            .write()
            .await
            .insert(cursor.cursor_id.clone(), cursor.clone());
        self.persist().await;
        cursor
    }

    pub async fn project_evm_transfer(
        &self,
        payload: EvmTransferProjectionRequest,
        now: DateTime<Utc>,
    ) -> EvmTransferProjectionResponse {
        let transfer_id = transfer_id(&payload);
        if let Some(existing) = self
            .update_existing_transfer(
                &transfer_id,
                payload.confirmations,
                payload.block_hash.clone(),
                now,
            )
            .await
        {
            let matched_intent = match existing.matched_intent_id.as_deref() {
                Some(intent_id) => self.evm_payment_intent_by_id(intent_id).await,
                None => None,
            };
            let invoice = match matched_intent.as_ref() {
                Some(intent) => self.invoice_for_intent(&intent.intent_id).await,
                None => None,
            };
            if let Some(invoice) = invoice.as_ref() {
                self.enqueue_webhook_event_if_ready(invoice).await;
                self.persist().await;
            }
            return EvmTransferProjectionResponse {
                transfer: existing,
                matched_intent,
                invoice,
            };
        }

        let matched = self.match_evm_intent(&payload, now).await;
        let matched_intent_id = matched.as_ref().map(|matched| matched.intent_id.clone());
        let transfer_status = matched
            .as_ref()
            .map(|matched| matched.status)
            .unwrap_or(EvmTransferStatus::Ignored);
        let transfer = EvmTransferLedgerEntry {
            transfer_id: transfer_id.clone(),
            chain_id: payload.chain_id,
            token_contract: payload.token_contract.trim().to_string(),
            tx_hash: payload.tx_hash.trim().to_string(),
            log_index: payload.log_index,
            block_number: payload.block_number,
            block_hash: payload.block_hash.clone(),
            from_address: payload.from_address.trim().to_string(),
            to_address: payload.to_address.trim().to_string(),
            amount_minor_units: payload.amount_minor_units,
            matched_intent_id: matched_intent_id.clone(),
            confirmations: payload.confirmations,
            status: transfer_status,
            observed_at: now,
            updated_at: now,
        };
        self.evm_transfer_ledger
            .write()
            .await
            .insert(transfer_id, transfer.clone());

        let (matched_intent, invoice) = if let Some(intent_id) = matched_intent_id {
            self.apply_evm_transfer_to_intent(&intent_id, &transfer, now)
                .await
        } else {
            (None, None)
        };

        self.persist().await;
        if let Some(invoice) = invoice.as_ref() {
            self.enqueue_webhook_event_if_ready(invoice).await;
            self.persist().await;
        }

        EvmTransferProjectionResponse {
            transfer,
            matched_intent,
            invoice,
        }
    }

    pub(crate) async fn evm_intents_by_project(&self, project_id: &str) -> Vec<EvmPaymentIntent> {
        let mut intents: Vec<_> = self
            .evm_payment_intents
            .read()
            .await
            .values()
            .filter(|intent| intent.project_id == project_id)
            .cloned()
            .collect();
        intents.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        intents
    }

    pub(crate) async fn evm_transfers_by_project(
        &self,
        project_id: &str,
    ) -> Vec<EvmTransferLedgerEntry> {
        let intent_ids = self
            .evm_payment_intents
            .read()
            .await
            .values()
            .filter(|intent| intent.project_id == project_id)
            .map(|intent| intent.intent_id.clone())
            .collect::<std::collections::HashSet<_>>();
        let mut transfers: Vec<_> = self
            .evm_transfer_ledger
            .read()
            .await
            .values()
            .filter(|transfer| {
                transfer
                    .matched_intent_id
                    .as_ref()
                    .is_some_and(|intent_id| intent_ids.contains(intent_id))
            })
            .cloned()
            .collect();
        transfers.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        transfers
    }

    pub(crate) async fn evm_asset_balances_by_project(
        &self,
        project_id: &str,
    ) -> Vec<EvmAssetBalance> {
        let intents: Vec<_> = self
            .evm_payment_intents
            .read()
            .await
            .values()
            .filter(|intent| intent.project_id == project_id)
            .cloned()
            .collect();
        let intent_by_id = intents
            .iter()
            .map(|intent| (intent.intent_id.clone(), intent.clone()))
            .collect::<std::collections::HashMap<_, _>>();
        let sessions_by_intent = self
            .checkout_sessions
            .read()
            .await
            .values()
            .filter(|session| session.project_id == project_id)
            .filter_map(|session| {
                session
                    .payment_intent_id
                    .as_ref()
                    .map(|intent_id| (intent_id.clone(), session.clone()))
            })
            .collect::<std::collections::HashMap<_, _>>();
        let withdrawals: Vec<_> = self
            .project_withdrawals
            .read()
            .await
            .values()
            .filter(|withdrawal| withdrawal.project_id == project_id)
            .filter(|withdrawal| {
                withdrawal.chain_id.is_some() && withdrawal.token_contract.is_some()
            })
            .cloned()
            .collect();
        let mut balances = std::collections::BTreeMap::<String, EvmAssetBalance>::new();
        for intent in &intents {
            let key = asset_balance_key(intent.chain_id, &intent.token_contract);
            balances.entry(key).or_insert_with(|| EvmAssetBalance {
                project_id: project_id.to_string(),
                chain_id: intent.chain_id,
                network: intent.network.clone(),
                token_symbol: intent.token_symbol.clone(),
                token_contract: intent.token_contract.clone(),
                token_decimals: intent.token_decimals,
                confirmed_minor_units: 0,
                pending_minor_units: 0,
                exception_minor_units: 0,
                withdrawable_minor_units: 0,
            });
        }

        for transfer in self.evm_transfer_ledger.read().await.values() {
            let Some(intent) = transfer
                .matched_intent_id
                .as_ref()
                .and_then(|intent_id| intent_by_id.get(intent_id))
            else {
                continue;
            };
            let key = asset_balance_key(intent.chain_id, &intent.token_contract);
            let Some(balance) = balances.get_mut(&key) else {
                continue;
            };
            match transfer.status {
                EvmTransferStatus::Confirmed => {
                    balance.confirmed_minor_units += transfer.amount_minor_units;
                    let merchant_net = transfer
                        .matched_intent_id
                        .as_ref()
                        .and_then(|intent_id| sessions_by_intent.get(intent_id))
                        .filter(|session| session.status == CheckoutSessionStatus::Paid)
                        .map(|session| session.billing.merchant_net_minor_units)
                        .unwrap_or(transfer.amount_minor_units);
                    balance.withdrawable_minor_units += merchant_net;
                }
                EvmTransferStatus::Detected => {
                    balance.pending_minor_units += transfer.amount_minor_units;
                }
                EvmTransferStatus::Underpaid
                | EvmTransferStatus::Overpaid
                | EvmTransferStatus::Expired
                | EvmTransferStatus::Reorged => {
                    balance.exception_minor_units += transfer.amount_minor_units;
                }
                EvmTransferStatus::Duplicate | EvmTransferStatus::Ignored => {}
            }
        }
        for withdrawal in &withdrawals {
            for balance in balances.values_mut() {
                if withdrawal_applies_to_balance(withdrawal, balance) {
                    balance.withdrawable_minor_units = balance
                        .withdrawable_minor_units
                        .saturating_sub(withdrawal.amount_minor_units);
                }
            }
        }

        balances.into_values().collect()
    }

    async fn update_existing_transfer(
        &self,
        transfer_id: &str,
        confirmations: u64,
        block_hash: Option<String>,
        now: DateTime<Utc>,
    ) -> Option<EvmTransferLedgerEntry> {
        let mut transfers = self.evm_transfer_ledger.write().await;
        let transfer = transfers.get_mut(transfer_id)?;
        if block_hash_conflicts(transfer.block_hash.as_deref(), block_hash.as_deref()) {
            transfer.status = EvmTransferStatus::Reorged;
            transfer.updated_at = now;
            let matched_intent_id = transfer.matched_intent_id.clone();
            let transfer = transfer.clone();
            drop(transfers);

            if let Some(intent_id) = matched_intent_id {
                self.mark_evm_intent_failed(&intent_id, now).await;
                self.persist().await;
            }

            return Some(transfer);
        }
        transfer.confirmations = transfer.confirmations.max(confirmations);
        if transfer.block_hash.is_none() {
            transfer.block_hash = block_hash;
        }
        transfer.updated_at = now;
        let matched_intent_id = transfer.matched_intent_id.clone();
        let mut transfer = transfer.clone();
        drop(transfers);

        if let Some(intent_id) = matched_intent_id {
            if transfer.status == EvmTransferStatus::Detected {
                if let Some(intent) = self.evm_payment_intent_by_id(&intent_id).await {
                    if transfer.confirmations >= intent.finality_threshold {
                        if let Some(stored) =
                            self.evm_transfer_ledger.write().await.get_mut(transfer_id)
                        {
                            stored.status = EvmTransferStatus::Confirmed;
                            stored.updated_at = now;
                        }
                    }
                }
            }
            transfer = self
                .evm_transfer_ledger
                .read()
                .await
                .get(transfer_id)
                .cloned()
                .unwrap_or(transfer);
            self.apply_evm_transfer_to_intent(&intent_id, &transfer, now)
                .await;
            self.persist().await;
        }

        Some(transfer)
    }

    async fn match_evm_intent(
        &self,
        payload: &EvmTransferProjectionRequest,
        now: DateTime<Utc>,
    ) -> Option<IntentMatch> {
        let intents = self.evm_payment_intents.read().await;
        let mut candidates: Vec<EvmPaymentIntent> = intents
            .values()
            .filter(|intent| intent.chain_id == payload.chain_id)
            .filter(|intent| {
                intent
                    .token_contract
                    .eq_ignore_ascii_case(&payload.token_contract)
            })
            .filter(|intent| {
                intent
                    .receiver_address
                    .eq_ignore_ascii_case(&payload.to_address)
            })
            .cloned()
            .collect();
        drop(intents);
        candidates.sort_by_key(|intent| intent.created_at);

        if let Some(intent) = candidates
            .iter()
            .filter(|intent| open_intent(intent, now))
            .next()
        {
            let matched_amount = self.matched_amount_for_intent(&intent.intent_id).await;
            let projected_amount = matched_amount.saturating_add(payload.amount_minor_units);
            let status = if projected_amount == intent.expected_amount_minor_units {
                transfer_status(payload.confirmations, intent.finality_threshold)
            } else if projected_amount < intent.expected_amount_minor_units {
                EvmTransferStatus::Underpaid
            } else {
                EvmTransferStatus::Overpaid
            };
            return Some(IntentMatch {
                intent_id: intent.intent_id.clone(),
                status,
            });
        }

        if let Some(intent) = candidates.iter().find(|intent| intent.expires_at <= now) {
            return Some(IntentMatch {
                intent_id: intent.intent_id.clone(),
                status: EvmTransferStatus::Expired,
            });
        }

        candidates
            .into_iter()
            .find(|intent| {
                intent.expected_amount_minor_units == payload.amount_minor_units
                    && matches!(
                        intent.status,
                        EvmPaymentIntentStatus::Detected | EvmPaymentIntentStatus::Confirmed
                    )
            })
            .map(|intent| IntentMatch {
                intent_id: intent.intent_id.clone(),
                status: EvmTransferStatus::Duplicate,
            })
    }

    async fn apply_evm_transfer_to_intent(
        &self,
        intent_id: &str,
        transfer: &EvmTransferLedgerEntry,
        now: DateTime<Utc>,
    ) -> (Option<EvmPaymentIntent>, Option<shared::InvoiceRecord>) {
        let matched_amount = self.matched_amount_for_intent(intent_id).await;
        let mut intents = self.evm_payment_intents.write().await;
        let Some(intent) = intents.get_mut(intent_id) else {
            return (None, None);
        };
        if transfer.status == EvmTransferStatus::Duplicate {
            let intent = intent.clone();
            drop(intents);
            let invoice = self.invoice_for_intent(intent_id).await;
            return (Some(intent), invoice);
        }

        intent.detected_tx_hash = Some(transfer.tx_hash.clone());
        intent.payer_address = Some(transfer.from_address.clone());
        intent.confirmations = intent.confirmations.max(transfer.confirmations);
        intent.matched_amount_minor_units = matched_amount;
        intent.status = intent_status_from_transfer(
            transfer.status,
            intent.confirmations,
            intent.finality_threshold,
        );
        intent.updated_at = now;
        let intent = intent.clone();
        drop(intents);

        if intent.status == EvmPaymentIntentStatus::Confirmed
            || intent.status == EvmPaymentIntentStatus::Expired
        {
            self.release_receiver_for_intent(&intent, now).await;
        }

        let invoice = self.apply_evm_intent_to_invoice(&intent, now).await;
        (Some(intent), invoice)
    }

    async fn matched_amount_for_intent(&self, intent_id: &str) -> u64 {
        self.evm_transfer_ledger
            .read()
            .await
            .values()
            .filter(|transfer| transfer.matched_intent_id.as_deref() == Some(intent_id))
            .filter(|transfer| {
                !matches!(
                    transfer.status,
                    EvmTransferStatus::Duplicate
                        | EvmTransferStatus::Ignored
                        | EvmTransferStatus::Expired
                        | EvmTransferStatus::Reorged
                )
            })
            .map(|transfer| transfer.amount_minor_units)
            .sum()
    }

    async fn mark_evm_intent_failed(
        &self,
        intent_id: &str,
        now: DateTime<Utc>,
    ) -> Option<shared::InvoiceRecord> {
        let mut intents = self.evm_payment_intents.write().await;
        let intent = intents.get_mut(intent_id)?;
        intent.status = EvmPaymentIntentStatus::Failed;
        intent.confirmations = 0;
        intent.updated_at = now;
        let intent = intent.clone();
        drop(intents);

        self.apply_evm_intent_to_invoice(&intent, now).await
    }

    async fn apply_evm_intent_to_invoice(
        &self,
        intent: &EvmPaymentIntent,
        now: DateTime<Utc>,
    ) -> Option<shared::InvoiceRecord> {
        let mut invoices = self.invoices.write().await;
        let invoice = invoices
            .values_mut()
            .find(|invoice| invoice.payment_intent_id.as_deref() == Some(&intent.intent_id))?;

        invoice.payment_rail = PaymentRail::EvmErc20;
        invoice.payment_tx_hash = intent.detected_tx_hash.clone();
        invoice.payer_address = intent.payer_address.clone();
        invoice.finality_confirmations = intent.confirmations;
        invoice.finality_threshold = intent.finality_threshold;
        invoice.snapshot.payment_truth = payment_truth_for_evm_intent(intent.status);
        invoice.snapshot.finality_status =
            finality_for_evm_intent(intent.status, intent.confirmations);
        let mut snapshot = invoice.snapshot.clone();
        if intent.status == EvmPaymentIntentStatus::Confirmed
            && snapshot.fulfillment_status != FulfillmentStatus::Released
        {
            snapshot.fulfillment_status = FulfillmentStatus::Ready;
        } else if !matches!(
            intent.status,
            EvmPaymentIntentStatus::Detected | EvmPaymentIntentStatus::Confirmed
        ) {
            snapshot.fulfillment_status = FulfillmentStatus::NotReady;
        }
        preserve_release_status(invoice, &mut snapshot);
        invoice.snapshot = snapshot;
        mark_webhook_pending_if_due(invoice);

        let invoice = invoice.clone();
        drop(invoices);

        if let Some(session) = self
            .checkout_sessions
            .write()
            .await
            .get_mut(&intent.checkout_session_id)
        {
            if intent.status == EvmPaymentIntentStatus::Confirmed {
                session.status = CheckoutSessionStatus::Paid;
                session.updated_at = now;
            } else if intent.status == EvmPaymentIntentStatus::Expired {
                session.status = CheckoutSessionStatus::Expired;
                session.updated_at = now;
            }
        }

        Some(invoice)
    }

    async fn release_receiver_for_intent(&self, intent: &EvmPaymentIntent, now: DateTime<Utc>) {
        let mut receivers = self.evm_receiver_addresses.write().await;
        let Some(receiver) = receivers.get_mut(&intent.receiver_id) else {
            return;
        };
        if receiver.lease_intent_id.as_deref() != Some(&intent.intent_id) {
            return;
        }

        receiver.lease_intent_id = None;
        receiver.leased_until = None;
        receiver.available_after = match intent.status {
            EvmPaymentIntentStatus::Confirmed => Some(now + receiver_reuse_delay()),
            EvmPaymentIntentStatus::Expired => Some(now),
            _ => receiver.available_after,
        };
    }

    async fn invoice_for_intent(&self, intent_id: &str) -> Option<shared::InvoiceRecord> {
        self.invoices
            .read()
            .await
            .values()
            .find(|invoice| invoice.payment_intent_id.as_deref() == Some(intent_id))
            .cloned()
    }
}

fn withdrawal_applies_to_balance(
    withdrawal: &ProjectWithdrawalRecord,
    balance: &EvmAssetBalance,
) -> bool {
    withdrawal.chain_id == Some(balance.chain_id)
        && withdrawal
            .token_contract
            .as_deref()
            .is_some_and(|token| token.eq_ignore_ascii_case(&balance.token_contract))
}

pub(crate) fn build_evm_payment_intent(
    intent_id: &str,
    project_id: &str,
    checkout_session_id: &str,
    amount_minor_units: u64,
    asset: &SupportedEvmAsset,
    now: DateTime<Utc>,
    expires_at: DateTime<Utc>,
) -> EvmPaymentIntent {
    EvmPaymentIntent {
        intent_id: intent_id.to_string(),
        checkout_session_id: checkout_session_id.to_string(),
        project_id: project_id.to_string(),
        chain_id: asset.chain_id,
        network: asset.network.clone(),
        token_symbol: asset.token_symbol.clone(),
        token_contract: asset.token_contract.clone(),
        token_decimals: asset.token_decimals,
        receiver_id: asset.receiver_id.clone(),
        receiver_address: asset.receiver_address.clone(),
        expected_amount_minor_units: amount_minor_units,
        matched_amount_minor_units: 0,
        status: EvmPaymentIntentStatus::RequiresPayment,
        detected_tx_hash: None,
        payer_address: None,
        confirmations: 0,
        finality_threshold: asset.finality_threshold,
        created_at: now,
        updated_at: now,
        expires_at,
    }
}

pub(crate) fn new_evm_payment_intent_id() -> String {
    format!("pi_{}", Uuid::new_v4().simple())
}
