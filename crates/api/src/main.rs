use api::{AppState, app};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let bind_addr = bind_addr();

    eprintln!("ZamaPay API initializing state before binding {bind_addr}...");
    let state = AppState::new().await;

    let listener = TcpListener::bind(&bind_addr)
        .await
        .expect("failed to bind API listener");

    eprintln!("ZamaPay API ready on {bind_addr}");
    axum::serve(listener, app(state))
        .await
        .expect("API server failed");
}

fn bind_addr() -> String {
    if let Ok(addr) = std::env::var("ZAMAPAY_API_BIND") {
        return addr;
    }

    std::env::var("PORT")
        .map(|port| format!("0.0.0.0:{port}"))
        .unwrap_or_else(|_| "127.0.0.1:18080".to_string())
}
