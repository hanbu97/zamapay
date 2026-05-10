use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use api::{AppState, app};
use storage::PortalStore;
use uuid::Uuid;

async fn test_state() -> AppState {
    let database_url = std::env::var("ZAMAPAY_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set ZAMAPAY_TEST_DATABASE_URL or DATABASE_URL for API tests");
    let state_key = format!("test-api-{}", Uuid::new_v4().simple());
    AppState::with_portal(PortalStore::connect_with_state_key(database_url, state_key).await)
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

async fn project_paid_checkout(app: &axum::Router, chain_invoice_id: u64, tx_hash: &str) {
    let paid = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/payment-projection"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "paymentTxHash": tx_hash,
                        "payerAddress": "0x0000000000000000000000000000000000000002"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paid.status(), StatusCode::OK);

    let finality = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!(
                    "/api/operator/chain-invoices/{chain_invoice_id}/confirmations"
                ))
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "confirmations": 2,
                        "finalityThreshold": 2
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(finality.status(), StatusCode::OK);
}

#[tokio::test]
async fn subscription_upgrade_is_chain_sourced_not_backend_mutated() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let missing_session = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/billing/subscription")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing_session.status(), StatusCode::UNAUTHORIZED);

    let subscription = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/billing/subscription")
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(subscription.status(), StatusCode::OK);
    let subscription = response_json(subscription).await;
    assert_eq!(subscription["subscription"]["plan"], "free");
    assert_eq!(
        subscription["subscription"]["entitlementStatus"],
        "contract_default"
    );
    assert!(subscription["subscription"]["passId"].is_null());
    assert_eq!(subscription["plans"].as_array().unwrap().len(), 3);
    assert!(subscription["payments"].as_array().unwrap().is_empty());

    let self_selected_growth = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Spoofed paid plan",
                        "environment": "local_dev",
                        "billingPlan": "growth"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(self_selected_growth.status(), StatusCode::FORBIDDEN);

    let intent = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/billing/subscription/upgrade-intent")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(json!({ "plan": "growth" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(intent.status(), StatusCode::OK);
    let intent = response_json(intent).await;
    assert_eq!(intent["plan"], "growth");
    assert_eq!(intent["billingCycle"], "monthly");
    assert_eq!(intent["planCode"], 2);
    assert_eq!(intent["priceMinorUnits"], 99000000);
    assert_eq!(intent["periodDays"], 30);
    assert_eq!(intent["expectedFeeBps"], 25);
    assert!(intent["passId"].is_null());
    assert!(intent["subscriptionRegistryContract"].as_str().is_some());

    let annual_intent = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/billing/subscription/upgrade-intent")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({ "plan": "growth", "billingCycle": "annual" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(annual_intent.status(), StatusCode::OK);
    let annual_intent = response_json(annual_intent).await;
    assert_eq!(annual_intent["billingCycle"], "annual");
    assert_eq!(annual_intent["priceMinorUnits"], 990000000);
    assert_eq!(annual_intent["periodDays"], 365);

    let rejected_local_upgrade = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/billing/subscription/upgrade")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "plan": "growth",
                        "chainTxHash": "0x1111111111111111111111111111111111111111111111111111111111111111",
                        "subscriptionCheckHandle": "0x2222222222222222222222222222222222222222222222222222222222222222"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected_local_upgrade.status(), StatusCode::LOCKED);

    let project = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/projects")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({
                        "name": "Growth merchant",
                        "environment": "local_dev"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(project.status(), StatusCode::OK);
    let project = response_json(project).await;
    let project_id = project["project"]["projectId"].as_str().unwrap();
    assert_eq!(project["project"]["billingPlan"], "free");

    let key = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/api-keys"))
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(
                    json!({ "label": "CardForge backend" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(key.status(), StatusCode::OK);
    let api_key = response_json(key).await["apiKey"]
        .as_str()
        .unwrap()
        .to_string();

    let free_checkout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .header("idempotency-key", "order-free")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-free",
                        "title": "Free checkout",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Contract default fee",
                        "chainInvoiceId": 21,
                        "chainTxHash": "0xfreecheckout"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(free_checkout.status(), StatusCode::OK);
    let free_checkout = response_json(free_checkout).await;
    let free_checkout_id = free_checkout["checkoutSessionId"].as_str().unwrap();
    let free_chain_invoice_id = free_checkout["chainInvoiceId"].as_u64().unwrap();
    assert_eq!(free_checkout["billing"]["plan"], "free");
    assert_eq!(free_checkout["billing"]["feeBps"], 50);
    assert_eq!(free_checkout["billing"]["platformFeeMinorUnits"], 600000);
    assert_eq!(free_checkout["billing"]["merchantNetMinorUnits"], 119400000);

    let projection = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(
                    "/api/operator/subscription-entitlements/0x0000000000000000000000000000000000000009/projection",
                )
                .header("content-type", "application/json")
                .header("x-operator-key", "local-operator-dev-key")
                .body(Body::from(
                    json!({
                        "plan": "growth",
                        "billingCycle": "monthly",
                        "passId": "pass_growth_0009",
                        "entitlementVersion": 1,
                        "entitlementTxHash": "0x3333333333333333333333333333333333333333333333333333333333333333",
                        "subscriptionCheckHandle": "0x4444444444444444444444444444444444444444444444444444444444444444"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(projection.status(), StatusCode::OK);
    let projection = response_json(projection).await;
    assert_eq!(projection["subscription"]["plan"], "growth");
    assert_eq!(projection["subscription"]["entitlementStatus"], "anchored");
    assert_eq!(projection["payments"].as_array().unwrap().len(), 1);
    assert_eq!(projection["payments"][0]["amountMinorUnits"], 99000000);

    let second_checkout = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/projects/{project_id}/checkout-sessions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .header("idempotency-key", "order-growth")
                .body(Body::from(
                    json!({
                        "merchantOrderId": "order-growth",
                        "title": "Growth checkout",
                        "amountLabel": "120 cUSDT",
                        "amountMinorUnits": 120000000,
                        "note": "Subscription controlled fee",
                        "chainInvoiceId": 22,
                        "chainTxHash": "0xgrowthcheckout"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_checkout.status(), StatusCode::OK);
    let second_checkout = response_json(second_checkout).await;
    let growth_chain_invoice_id = second_checkout["chainInvoiceId"].as_u64().unwrap();
    assert_eq!(second_checkout["billing"]["plan"], "growth");
    assert_eq!(second_checkout["billing"]["feeBps"], 25);
    assert_eq!(second_checkout["billing"]["platformFeeMinorUnits"], 300000);
    assert_eq!(
        second_checkout["billing"]["merchantNetMinorUnits"],
        119700000
    );

    let old_detail = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/projects/{project_id}/checkout-sessions/{free_checkout_id}"
                ))
                .header("authorization", format!("Bearer {api_key}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(old_detail.status(), StatusCode::OK);
    let old_detail = response_json(old_detail).await;
    assert_eq!(old_detail["billing"]["plan"], "free");
    assert_eq!(old_detail["billing"]["platformFeeMinorUnits"], 600000);

    project_paid_checkout(&app, free_chain_invoice_id, "0xpaid-free").await;
    project_paid_checkout(&app, growth_chain_invoice_id, "0xpaid-growth").await;

    let overview = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!("/api/projects/{project_id}"))
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(overview.status(), StatusCode::OK);
    let overview = response_json(overview).await;
    assert_eq!(overview["summary"]["totalCheckouts"], 2);
    assert_eq!(overview["summary"]["paidCheckouts"], 2);
    assert_eq!(overview["summary"]["grossVolumeMinorUnits"], 240000000);
    assert_eq!(overview["summary"]["platformFeeMinorUnits"], 900000);
    assert_eq!(overview["summary"]["merchantNetMinorUnits"], 239100000);
}

#[tokio::test]
async fn enterprise_plan_requires_review() {
    let state = test_state().await;
    let seeded_session = state
        .issue_dev_session("0x0000000000000000000000000000000000000009")
        .await;
    let cookie = format!("zamapay_session={}", seeded_session.session_id);
    let app = app(state);

    let response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/billing/subscription/upgrade")
                .header("content-type", "application/json")
                .header("cookie", &cookie)
                .body(Body::from(json!({ "plan": "enterprise" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::LOCKED);
}
