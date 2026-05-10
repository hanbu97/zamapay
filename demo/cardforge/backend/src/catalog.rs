use uuid::Uuid;

use crate::{
    error::ApiError,
    types::{CreateCheckoutSessionRequest, Product, ReleasedCard},
};

const DEFAULT_PRODUCT_ID: &str = "mythic-loadout";

pub(crate) struct ProductDefinition {
    pub(crate) amount_label: &'static str,
    pub(crate) amount_minor_units: u64,
    pub(crate) codes: &'static [&'static str],
    pub(crate) id: &'static str,
    pub(crate) note: &'static str,
    pub(crate) title: &'static str,
}

static PRODUCT_CATALOG: &[ProductDefinition] = &[
    ProductDefinition {
        amount_label: "40 cUSDT",
        amount_minor_units: 40_000_000,
        codes: &["Credit shard", "Starter boost", "Instant access code"],
        id: "neon-credit",
        note: "Credit shard, starter boost, and one instant access code release after ZamaPay reports finality-safe payment.",
        title: "Neon Credit Card",
    },
    ProductDefinition {
        amount_label: "80 cUSDT",
        amount_minor_units: 80_000_000,
        codes: &["Arena entry code", "Demo wallet credit", "Reward slot code"],
        id: "arena-access",
        note: "Match entry, demo wallet credit, and a timed reward slot release after finality-safe payment.",
        title: "Arena Access Card",
    },
    ProductDefinition {
        amount_label: "120 cUSDT",
        amount_minor_units: 120_000_000,
        codes: &[
            "SEA prepaid code",
            "Game wallet code",
            "Instant access code",
        ],
        id: DEFAULT_PRODUCT_ID,
        note: "Three CardForge demo codes release after ZamaPay reports finality-safe payment.",
        title: "Mythic Loadout Card",
    },
    ProductDefinition {
        amount_label: "160 cUSDT",
        amount_minor_units: 160_000_000,
        codes: &[
            "Cosmetic vault code",
            "Skin claim code",
            "Delivery receipt code",
        ],
        id: "cyber-skin",
        note: "Cosmetic vault claim codes release after encrypted checkout finality.",
        title: "Cyber Skin Card",
    },
    ProductDefinition {
        amount_label: "200 cUSDT",
        amount_minor_units: 200_000_000,
        codes: &[
            "Founder credit code",
            "Premium access code",
            "Vault drop code",
        ],
        id: "founders-drop",
        note: "Premium pack codes for credits, access, loadout, and vault drops release after finality-safe payment.",
        title: "Founders Drop Card",
    },
];

pub(crate) fn products() -> impl Iterator<Item = Product> {
    PRODUCT_CATALOG.iter().map(product)
}

pub(crate) fn default_product() -> &'static ProductDefinition {
    match selected_product(Some(DEFAULT_PRODUCT_ID)) {
        Ok(product) => product,
        Err(_) => panic!("default product must exist"),
    }
}

pub(crate) fn selected_product(
    product_id: Option<&str>,
) -> Result<&'static ProductDefinition, ApiError> {
    let product_id = product_id.unwrap_or(DEFAULT_PRODUCT_ID);
    PRODUCT_CATALOG
        .iter()
        .find(|product| product.id == product_id)
        .ok_or_else(|| {
            ApiError::bad_request(
                "unknown_product",
                format!("CardForge product `{product_id}` does not exist."),
            )
        })
}

pub(crate) fn product_for_amount_minor_units(
    amount_minor_units: Option<u64>,
) -> &'static ProductDefinition {
    amount_minor_units
        .and_then(|amount| {
            PRODUCT_CATALOG
                .iter()
                .find(|product| product.amount_minor_units == amount)
        })
        .unwrap_or_else(default_product)
}

pub(crate) fn product(definition: &ProductDefinition) -> Product {
    Product {
        amount_label: definition.amount_label.to_string(),
        amount_minor_units: definition.amount_minor_units,
        codes: definition
            .codes
            .iter()
            .map(|code| code.to_string())
            .collect(),
        id: definition.id.to_string(),
        title: definition.title.to_string(),
    }
}

pub(crate) fn checkout_payload(selected: &ProductDefinition) -> CreateCheckoutSessionRequest {
    let order_id = format!("cardforge-{}-{}", selected.id, Uuid::new_v4().simple());
    let mut metadata = std::collections::BTreeMap::new();
    metadata.insert("productId".to_string(), selected.id.to_string());
    metadata.insert("productTitle".to_string(), selected.title.to_string());
    metadata.insert("source".to_string(), "cardforge".to_string());

    CreateCheckoutSessionRequest {
        amount_label: selected.amount_label.to_string(),
        amount_minor_units: selected.amount_minor_units,
        cancel_url: None,
        chain_invoice_id: None,
        chain_tx_hash: None,
        merchant_order_id: order_id,
        metadata,
        note: selected.note.to_string(),
        success_url: None,
        title: selected.title.to_string(),
    }
}

pub(crate) fn released_cards(
    checkout_session_id: &str,
    selected: &ProductDefinition,
) -> Vec<ReleasedCard> {
    let suffix = checkout_suffix(checkout_session_id);

    selected
        .codes
        .iter()
        .enumerate()
        .map(|(index, label)| ReleasedCard {
            label: (*label).to_string(),
            secret: format!("CF-{}-{}", index + 1, suffix),
        })
        .collect()
}

fn checkout_suffix(checkout_session_id: &str) -> String {
    let clean: String = checkout_session_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    let start = clean.len().saturating_sub(8);

    clean[start..].to_ascii_uppercase()
}
