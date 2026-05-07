use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::json;
use tower::ServiceExt;

use api::{AppState, app};

#[tokio::test]
async fn auth_nonce_session_roundtrip_requires_signature_and_mints_session() {
    let app = app(AppState::new());

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
