#!/usr/bin/env bash
set -euo pipefail

. env/local-dev.zamapay-api.env

database_url="${ZAMAPAY_TEST_DATABASE_URL:-$DATABASE_URL}"

exec env -i \
  HOME="$HOME" \
  PATH="$PATH" \
  TMPDIR="${TMPDIR:-/tmp}" \
  CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" \
  RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}" \
  DATABASE_URL="$database_url" \
  ZAMAPAY_RUNTIME_PROFILE="${ZAMAPAY_RUNTIME_PROFILE:-local-dev}" \
  ZAMAPAY_SECRET_ENCRYPTION_KEY="${ZAMAPAY_SECRET_ENCRYPTION_KEY:-local-webhook-secret-encryption-key-for-tests}" \
  RUST_TEST_THREADS="${RUST_TEST_THREADS:-1}" \
  cargo test --workspace
