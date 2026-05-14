# Webhook Verifier Architecture

## Scope

- `src/lib.rs` owns the Svix-style external webhook protocol: `svix-*` header names, `whsec_` base64 secrets, raw-body HMAC-SHA256 signing, timestamp tolerance, constant-time signature comparison, secret preview, payload hash, and generated endpoint secret material.

## Tree

```text
webhook-verifier
|-- Cargo.toml        # Standalone dependency contract for platform and merchant demos
|-- ARCHITECTURE.md   # This boundary record
`-- src/
    `-- lib.rs        # Pure signing and verification helpers
```

## Decisions

- This crate has no dependency on ZamaPay DTOs, storage, Axum, or merchant demo state; it is protocol code only.
- Both the platform dispatcher and merchant demo receivers must use this crate instead of carrying local HMAC helpers.
- Secrets fail closed: `whsec_` values must decode as base64 before signing or verification.
- Timestamp checks follow the Svix Rust verifier shape: malformed timestamps are invalid, old timestamps and future timestamps are distinct failures, and the default tolerance is five minutes.
