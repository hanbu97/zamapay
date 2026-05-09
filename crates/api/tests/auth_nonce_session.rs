use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use api::{AppState, app};
use storage::PortalStore;
use uuid::Uuid;

async fn test_state() -> AppState {
    let database_url = std::env::var("MERMER_TEST_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .expect("set MERMER_TEST_DATABASE_URL or DATABASE_URL for API tests");
    let state_key = format!("test-api-{}", Uuid::new_v4().simple());
    AppState::with_portal(PortalStore::connect_with_state_key(database_url, state_key).await)
}

#[tokio::test]
async fn auth_nonce_session_roundtrip_requires_signature_and_mints_session() {
    let app = app(test_state().await);

    let nonce_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/nonce")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "address": "0x0000000000000000000000000000000000000001"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(nonce_response.status(), StatusCode::OK);

    let nonce_body = axum::body::to_bytes(nonce_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let nonce_json: serde_json::Value = serde_json::from_slice(&nonce_body).unwrap();

    let verify_response = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/verify")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "address": "0x0000000000000000000000000000000000000001",
                        "nonce": nonce_json["nonce"],
                        "message": nonce_json["message"],
                        "signature": "0xdeadbeef"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(verify_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn deleting_session_clears_cookie_and_invalidates_store_session() {
    let state = test_state().await;
    let user = state
        .issue_dev_session("0x0000000000000000000000000000000000000001")
        .await;
    let session_cookie = format!("mermer_session={}", user.session_id);
    let app = app(state);

    let active_session = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/session")
                .header("cookie", session_cookie.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(active_session.status(), StatusCode::OK);

    let active_body = axum::body::to_bytes(active_session.into_body(), usize::MAX)
        .await
        .unwrap();
    let active_json: serde_json::Value = serde_json::from_slice(&active_body).unwrap();
    assert_eq!(active_json["authenticated"], true);

    let logout_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::DELETE)
                .uri("/api/session")
                .header("cookie", session_cookie.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout_response.status(), StatusCode::NO_CONTENT);
    assert!(
        logout_response
            .headers()
            .get_all("set-cookie")
            .iter()
            .any(|value| value
                .to_str()
                .unwrap_or_default()
                .starts_with("mermer_session="))
    );

    let stale_session = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/session")
                .header("cookie", session_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(stale_session.status(), StatusCode::OK);

    let stale_body = axum::body::to_bytes(stale_session.into_body(), usize::MAX)
        .await
        .unwrap();
    let stale_json: serde_json::Value = serde_json::from_slice(&stale_body).unwrap();
    assert_eq!(stale_json["authenticated"], false);
}
