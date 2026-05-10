use axum::http::{HeaderName, HeaderValue, Method, header};
use axum_extra::extract::cookie::{Cookie, SameSite};
use tower_http::cors::{AllowOrigin, CorsLayer};

const ALLOWED_ORIGINS_ENV: &str = "ZAMAPAY_ALLOWED_ORIGINS";
const SESSION_COOKIE_SAMESITE_ENV: &str = "ZAMAPAY_SESSION_COOKIE_SAMESITE";
const SESSION_COOKIE_SECURE_ENV: &str = "ZAMAPAY_SESSION_COOKIE_SECURE";

pub fn cors_layer() -> CorsLayer {
    let allowed_origins = configured_origins();

    CorsLayer::new()
        .allow_methods([Method::DELETE, Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("idempotency-key"),
            HeaderName::from_static("x-operator-key"),
            HeaderName::from_static("x-zama-gateway-key"),
        ])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate(
            move |origin: &HeaderValue, _| match origin.to_str() {
                Ok(origin) => origin_is_allowed(origin, &allowed_origins),
                Err(_) => false,
            },
        ))
}

pub fn session_cookie(name: &'static str, value: String) -> Cookie<'static> {
    let mut cookie = Cookie::build((name, value))
        .path("/")
        .http_only(true)
        .same_site(session_cookie_same_site());

    if session_cookie_secure() {
        cookie = cookie.secure(true);
    }

    cookie.build()
}

pub fn expired_session_cookie(name: &'static str) -> Cookie<'static> {
    let mut cookie = Cookie::build(name)
        .path("/")
        .http_only(true)
        .same_site(session_cookie_same_site());

    if session_cookie_secure() {
        cookie = cookie.secure(true);
    }

    cookie.build()
}

fn configured_origins() -> Vec<String> {
    std::env::var(ALLOWED_ORIGINS_ENV)
        .unwrap_or_default()
        .split(',')
        .filter_map(normalize_origin)
        .collect()
}

fn normalize_origin(origin: &str) -> Option<String> {
    let origin = origin.trim().trim_end_matches('/');
    (!origin.is_empty()).then(|| origin.to_string())
}

fn origin_is_allowed(origin: &str, configured_origins: &[String]) -> bool {
    let origin = origin.trim_end_matches('/');
    is_local_origin(origin)
        || configured_origins
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(origin))
}

fn is_local_origin(origin: &str) -> bool {
    origin.starts_with("http://127.0.0.1:") || origin.starts_with("http://localhost:")
}

fn session_cookie_same_site() -> SameSite {
    match std::env::var(SESSION_COOKIE_SAMESITE_ENV)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "none" => SameSite::None,
        "strict" => SameSite::Strict,
        _ => SameSite::Lax,
    }
}

fn session_cookie_secure() -> bool {
    matches!(
        std::env::var(SESSION_COOKIE_SECURE_ENV)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_local_and_configured_origins() {
        let configured = vec!["https://zamapay-web.up.railway.app".to_string()];

        assert!(origin_is_allowed("http://127.0.0.1:3000", &configured));
        assert!(origin_is_allowed("http://localhost:3000", &configured));
        assert!(origin_is_allowed(
            "https://zamapay-web.up.railway.app",
            &configured
        ));
        assert!(origin_is_allowed(
            "https://zamapay-web.up.railway.app/",
            &configured
        ));
        assert!(!origin_is_allowed("https://evil.example", &configured));
    }
}
