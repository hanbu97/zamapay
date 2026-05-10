use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use sea_orm::DbErr;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: &'static str,
    login_url: Option<String>,
    message: String,
}

pub(crate) struct ApiError {
    body: ErrorBody,
    status: StatusCode,
}

impl ApiError {
    pub(crate) fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message, None)
    }

    pub(crate) fn project_auth_failed() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "zamapay_project_auth_failed",
            "CardForge backend rejected the configured ZamaPay project API key.",
            None,
        )
    }

    pub(crate) fn upstream_unreachable(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("ZamaPay API is unreachable: {error}"),
            None,
        )
    }

    pub(crate) async fn upstream_rejected(status: u16, response: reqwest::Response) -> Self {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("ZamaPay API rejected the checkout with status {status}.")
        } else {
            body
        };

        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    pub(crate) fn bad_upstream_json(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            format!("ZamaPay API returned an invalid checkout response: {error}"),
            None,
        )
    }

    pub(crate) fn bad_upstream_shape(message: &str) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "checkout_create_failed",
            message,
            None,
        )
    }

    pub(crate) fn chain_invoice_unreachable(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            format!("ZamaPay local chain invoice API is unreachable: {error}"),
            None,
        )
    }

    pub(crate) async fn chain_invoice_rejected(status: u16, response: reqwest::Response) -> Self {
        let body = response.text().await.unwrap_or_default();
        let message = if body.is_empty() {
            format!("ZamaPay local chain invoice API rejected the request with status {status}.")
        } else {
            body
        };

        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            message,
            None,
        )
    }

    pub(crate) fn bad_chain_invoice_json(error: reqwest::Error) -> Self {
        Self::new(
            StatusCode::BAD_GATEWAY,
            "chain_invoice_create_failed",
            format!("ZamaPay local chain invoice API returned invalid JSON: {error}"),
            None,
        )
    }

    pub(crate) fn invalid_webhook_signature(message: &str) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "invalid_webhook_signature",
            message,
            None,
        )
    }

    pub(crate) fn internal(message: &str) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            message,
            None,
        )
    }

    pub(crate) fn database_failed(error: DbErr) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "cardforge_store_failed",
            format!("CardForge Postgres store is unavailable: {error}"),
            None,
        )
    }

    fn new(
        status: StatusCode,
        code: &'static str,
        message: impl Into<String>,
        login_url: Option<String>,
    ) -> Self {
        Self {
            body: ErrorBody {
                code,
                login_url,
                message: message.into(),
            },
            status,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}
