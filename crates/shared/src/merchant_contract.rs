use serde::{Deserialize, Serialize};

pub const ZAMAPAY_API_VERSION_HEADER: &str = "ZamaPay-Version";
pub const ZAMAPAY_PREVIEW_API_VERSION: &str = "2026-05-14";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MerchantApiErrorType {
    AuthenticationError,
    InvalidRequestError,
    ApiError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantApiError {
    #[serde(rename = "type")]
    pub kind: MerchantApiErrorType,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MerchantApiErrorEnvelope {
    pub error: MerchantApiError,
}
