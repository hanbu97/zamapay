use api::{AppState, app};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let bind_addr =
        std::env::var("ZAMAPAY_API_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let listener = TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind API listener");

    axum::serve(listener, app(AppState::new().await))
        .await
        .expect("API server failed");
}
