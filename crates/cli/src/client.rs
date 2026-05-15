use anyhow::{Context, Result, bail};
use reqwest::StatusCode;
use reqwest::header::{COOKIE, HeaderMap};
use serde::Serialize;
use serde::de::DeserializeOwned;
use shared::{
    CheckoutQuoteRequest, CheckoutQuoteResponse, CheckoutSessionResponse,
    ConfigureWebhookEndpointRequest, ConfigureWebhookEndpointResponse,
    CreateCheckoutSessionRequest, CreatePaymentProjectRequest, CreatePaymentProjectResponse,
    CreateProjectApiKeyRequest, CreateProjectApiKeyResponse, CreateProjectWithdrawalRequest,
    NonceRequest, NonceResponse, PaymentProject, ProjectApiKey, ProjectDashboardOverview,
    ProjectSecretBootstrapResponse, RotateWebhookEndpointSecretResponse, SessionResponse,
    SupportedEvmAsset, UpdateProjectPaymentRailRequest, VerifyRequest, WebhookDeliveryRecord,
    WebhookEventRecord,
};

use crate::config::{clean_api_url, require};

const VERSION_HEADER: &str = "ZamaPay-Version";
const DEFAULT_VERSION: &str = "2026-05-14";
const IDEMPOTENCY_KEY_HEADER: &str = "idempotency-key";

pub struct ApiClient {
    api_url: String,
    http: reqwest::Client,
}

impl ApiClient {
    pub fn new(api_url: &str) -> Result<Self> {
        let api_url = clean_api_url(api_url);
        require(!api_url.is_empty(), "api URL cannot be empty")?;
        Ok(Self {
            api_url,
            http: reqwest::Client::new(),
        })
    }

    pub fn api_url(&self) -> &str {
        &self.api_url
    }

    pub async fn health(&self) -> Result<String> {
        let response = self.http.get(self.url("/health")).send().await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        require(
            status == StatusCode::OK && body.trim() == "ok",
            &format!("unexpected health response {status}: {body}"),
        )?;
        Ok("ok".to_string())
    }

    pub async fn auth_nonce(&self, address: &str) -> Result<NonceResponse> {
        self.post_public(
            "/api/auth/nonce",
            &NonceRequest {
                address: address.to_string(),
            },
        )
        .await
    }

    pub async fn auth_verify(&self, request: &VerifyRequest) -> Result<SessionResponse> {
        self.post_public("/api/auth/verify", request).await
    }

    pub async fn session(&self, session_id: &str) -> Result<SessionResponse> {
        self.get_control("/api/session", session_id).await
    }

    pub async fn logout(&self, session_id: &str) -> Result<()> {
        let response = self
            .http
            .delete(self.url("/api/session"))
            .header(COOKIE, session_cookie(session_id))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("ZamaPay API returned {status}: {body}");
        }
        Ok(())
    }

    pub async fn list_projects(&self, session_id: &str) -> Result<Vec<PaymentProject>> {
        self.get_control("/api/projects", session_id).await
    }

    pub async fn create_project(
        &self,
        session_id: &str,
        request: &CreatePaymentProjectRequest,
    ) -> Result<CreatePaymentProjectResponse> {
        self.post_control("/api/projects", session_id, request)
            .await
    }

    pub async fn project_overview(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<ProjectDashboardOverview> {
        self.get_control(&format!("/api/projects/{project_id}"), session_id)
            .await
    }

    pub async fn update_rail(
        &self,
        session_id: &str,
        project_id: &str,
        rail: &str,
        enabled: bool,
    ) -> Result<ProjectDashboardOverview> {
        self.patch_control(
            &format!("/api/projects/{project_id}/payment-rails/{rail}"),
            session_id,
            &UpdateProjectPaymentRailRequest { enabled },
        )
        .await
    }

    pub async fn create_project_secret(
        &self,
        session_id: &str,
        project_id: &str,
        request: &CreateProjectApiKeyRequest,
    ) -> Result<CreateProjectApiKeyResponse> {
        self.post_control(
            &format!("/api/projects/{project_id}/project-secrets"),
            session_id,
            request,
        )
        .await
    }

    pub async fn revoke_project_secret(
        &self,
        session_id: &str,
        project_id: &str,
        key_id: &str,
    ) -> Result<ProjectApiKey> {
        self.post_empty_control(
            &format!("/api/projects/{project_id}/project-secrets/{key_id}/revoke"),
            session_id,
        )
        .await
    }

    pub async fn create_webhook_endpoint(
        &self,
        session_id: &str,
        project_id: &str,
        request: &ConfigureWebhookEndpointRequest,
    ) -> Result<ConfigureWebhookEndpointResponse> {
        self.post_control(
            &format!("/api/projects/{project_id}/webhook-endpoints"),
            session_id,
            request,
        )
        .await
    }

    pub async fn update_webhook_endpoint(
        &self,
        session_id: &str,
        project_id: &str,
        endpoint_id: &str,
        request: &ConfigureWebhookEndpointRequest,
    ) -> Result<shared::ProjectWebhookEndpoint> {
        self.patch_control(
            &format!("/api/projects/{project_id}/webhook-endpoints/{endpoint_id}"),
            session_id,
            request,
        )
        .await
    }

    pub async fn rotate_webhook_secret(
        &self,
        session_id: &str,
        project_id: &str,
        endpoint_id: &str,
    ) -> Result<RotateWebhookEndpointSecretResponse> {
        self.post_empty_control(
            &format!("/api/projects/{project_id}/webhook-endpoints/{endpoint_id}/rotate-secret"),
            session_id,
        )
        .await
    }

    pub async fn test_webhook_endpoint(
        &self,
        session_id: &str,
        project_id: &str,
        endpoint_id: &str,
    ) -> Result<Vec<WebhookDeliveryRecord>> {
        self.post_empty_control(
            &format!("/api/projects/{project_id}/webhook-endpoints/{endpoint_id}/test"),
            session_id,
        )
        .await
    }

    pub async fn list_events(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Vec<WebhookEventRecord>> {
        self.get_control(&format!("/api/projects/{project_id}/events"), session_id)
            .await
    }

    pub async fn list_deliveries(
        &self,
        session_id: &str,
        project_id: &str,
    ) -> Result<Vec<WebhookDeliveryRecord>> {
        self.get_control(
            &format!("/api/projects/{project_id}/deliveries"),
            session_id,
        )
        .await
    }

    pub async fn resend_delivery(
        &self,
        session_id: &str,
        project_id: &str,
        delivery_id: &str,
    ) -> Result<Vec<WebhookDeliveryRecord>> {
        self.post_empty_control(
            &format!("/api/projects/{project_id}/deliveries/{delivery_id}/resend"),
            session_id,
        )
        .await
    }

    pub async fn create_withdrawal(
        &self,
        session_id: &str,
        project_id: &str,
        request: &CreateProjectWithdrawalRequest,
    ) -> Result<ProjectDashboardOverview> {
        self.post_control(
            &format!("/api/projects/{project_id}/withdrawals"),
            session_id,
            request,
        )
        .await
    }

    pub async fn supported_assets(&self) -> Result<Vec<SupportedEvmAsset>> {
        self.get_public("/api/supported-assets").await
    }

    pub async fn bootstrap(&self, secret_key: &str) -> Result<ProjectSecretBootstrapResponse> {
        self.get_secret("/api/project-secret/bootstrap", secret_key)
            .await
    }

    pub async fn create_checkout(
        &self,
        project_id: &str,
        secret_key: &str,
        idempotency_key: &str,
        request: &CreateCheckoutSessionRequest,
    ) -> Result<CheckoutSessionResponse> {
        self.post_secret(
            &format!("/api/projects/{project_id}/checkout-sessions"),
            secret_key,
            idempotency_key,
            request,
        )
        .await
    }

    pub async fn checkout_quote(
        &self,
        project_id: &str,
        secret_key: &str,
        amount_minor_units: u64,
    ) -> Result<CheckoutQuoteResponse> {
        self.post_secret_without_idempotency(
            &format!("/api/projects/{project_id}/checkout-quote"),
            secret_key,
            &CheckoutQuoteRequest { amount_minor_units },
        )
        .await
    }

    async fn get_public<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        parse_response(self.versioned(self.http.get(self.url(path))).send().await?).await
    }

    async fn post_public<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        parse_response(
            self.versioned(self.http.post(self.url(path)))
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    async fn get_control<T: DeserializeOwned>(&self, path: &str, session_id: &str) -> Result<T> {
        parse_response(
            self.control(self.http.get(self.url(path)), session_id)
                .send()
                .await?,
        )
        .await
    }

    async fn post_control<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        session_id: &str,
        body: &B,
    ) -> Result<T> {
        parse_response(
            self.control(self.http.post(self.url(path)), session_id)
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    async fn patch_control<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        session_id: &str,
        body: &B,
    ) -> Result<T> {
        parse_response(
            self.control(self.http.patch(self.url(path)), session_id)
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    async fn post_empty_control<T: DeserializeOwned>(
        &self,
        path: &str,
        session_id: &str,
    ) -> Result<T> {
        parse_response(
            self.control(self.http.post(self.url(path)), session_id)
                .send()
                .await?,
        )
        .await
    }

    async fn get_secret<T: DeserializeOwned>(&self, path: &str, secret_key: &str) -> Result<T> {
        parse_response(
            self.versioned(self.http.get(self.url(path)))
                .bearer_auth(secret_key)
                .send()
                .await?,
        )
        .await
    }

    async fn post_secret<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        secret_key: &str,
        idempotency_key: &str,
        body: &B,
    ) -> Result<T> {
        parse_response(
            self.versioned(self.http.post(self.url(path)))
                .bearer_auth(secret_key)
                .header(IDEMPOTENCY_KEY_HEADER, idempotency_key)
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    async fn post_secret_without_idempotency<T: DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        secret_key: &str,
        body: &B,
    ) -> Result<T> {
        parse_response(
            self.versioned(self.http.post(self.url(path)))
                .bearer_auth(secret_key)
                .json(body)
                .send()
                .await?,
        )
        .await
    }

    fn versioned(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request.header(VERSION_HEADER, DEFAULT_VERSION)
    }

    fn control(
        &self,
        request: reqwest::RequestBuilder,
        session_id: &str,
    ) -> reqwest::RequestBuilder {
        self.versioned(request)
            .header(COOKIE, session_cookie(session_id))
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.api_url, path)
    }
}

pub fn session_cookie(session_id: &str) -> String {
    format!("zamapay_session={}", session_id.trim())
}

pub async fn parse_response<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("ZamaPay API returned {status}: {body}");
    }
    serde_json::from_str(&body).with_context(|| {
        format!(
            "failed to decode ZamaPay API response ({}): {body}",
            request_id(&headers).unwrap_or("-")
        )
    })
}

fn request_id(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
}
