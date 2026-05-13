set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

zamapay_web_cache := "apps/web/.next"
cardforge_web_cache := "demo/cardforge/frontend/.next"

default:
    @just --list

# Install workspace dependencies after `mise install`.
setup:
    mise exec -- npm install
    mise exec -- npm --prefix demo/cardforge/frontend install
    mise exec -- node scripts/sync-cardforge-frontend-generated.js

# Sync standalone CardForge frontend generated snapshots.
sync-cardforge-generated:
    mise exec -- node scripts/sync-cardforge-frontend-generated.js

# Seed CardForge's ignored local env with a fresh ZamaPay project/API key.
seed-cardforge-local-project:
    mise exec -- node scripts/seed-cardforge-local-project.js

# Print the tool versions that shape local builds.
doctor:
    @mise --version
    @mise exec -- node -v
    @mise exec -- npm -v
    @just --version
    @cargo --version
    @rustc --version
    @docker compose version

# Start local Postgres.
db-up:
    docker compose up -d postgres

# Stop local Postgres without deleting volumes.
db-down:
    docker compose down

# Remove ZamaPay Next/Turbopack cache.
clean-zamapay-web-cache:
    rm -rf {{ zamapay_web_cache }}

# Remove CardForge Next/Turbopack cache.
clean-cardforge-web-cache:
    rm -rf {{ cardforge_web_cache }}

# Remove generated local web caches that can survive env/profile/rename changes.
clean-local-dev: clean-zamapay-web-cache clean-cardforge-web-cache
    @echo "local-dev web caches cleared"

# Start the local Hardhat node.
contracts-node:
    mise exec -- npm --workspace contracts run node

# Reset local databases, redeploy local contracts, and clear local web caches.
reset-local:
    mise exec -- node scripts/reset-local-dev.js
    just clean-local-dev

# Verify one runtime profile.
verify-runtime profile="local-dev":
    mise exec -- node scripts/verify-runtime-profile.js {{ profile }}

# Fast local acceptance gate. Requires API, web, and Hardhat to be running.
verify-local:
    mise exec -- node scripts/local-readiness.js

# Full local acceptance gate.
verify-full:
    mise exec -- node scripts/local-full-verify.js

# Check web, contracts, and Rust workspaces.
check:
    mise exec -- npm run test:web
    mise exec -- npm run lint:web
    mise exec -- npm run test:contracts
    cargo fmt --all --check
    just rust-test

# Test the Rust workspace with only the local database URL.
rust-test: db-up
    scripts/run-rust-tests.sh

# Build the ZamaPay web app.
build-web:
    mise exec -- npm run build:web

# Start the ZamaPay Rust API against local-dev.
api-local:
    scripts/run-with-env.sh env/local-dev.zamapay-api.env -- cargo run -p api

# Start the ZamaPay web app against local-dev.
web-local: clean-zamapay-web-cache
    scripts/run-with-env.sh env/local-dev.zamapay-web.env -- mise exec -- npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001

# Start the CardForge backend against local-dev.
cardforge-api-local:
    scripts/run-with-env.sh env/local-dev.cardforge-backend.env -- cargo run --manifest-path demo/cardforge/backend/Cargo.toml

# Start the CardForge frontend against local-dev.
cardforge-web-local: clean-cardforge-web-cache
    scripts/run-with-env.sh env/local-dev.cardforge-frontend.env -- mise exec -- npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002

# Start the ZamaPay API with local chain and Supabase Postgres.
api-supabase-local:
    scripts/run-with-env.sh env/local-dev.zamapay-api.env env/supabase.zamapay-api.env -- cargo run -p api

# Start the CardForge backend with local chain and Supabase Postgres.
cardforge-api-supabase-local:
    scripts/run-with-env.sh env/local-dev.cardforge-backend.env env/supabase.cardforge-backend.env -- cargo run --manifest-path demo/cardforge/backend/Cargo.toml

# Deploy contracts to Sepolia. Requires env/sepolia.contracts.env.
deploy-sepolia-contracts:
    scripts/run-with-env.sh env/sepolia.contracts.env -- mise exec -- npm --workspace contracts run deploy:sepolia
    mise exec -- node scripts/sync-cardforge-frontend-generated.js
    just clean-local-dev

# Start the ZamaPay API for Sepolia contracts with hosted Postgres.
api-sepolia-local-ui:
    scripts/run-with-env.sh env/local-dev.zamapay-api.env env/supabase.zamapay-api.env env/sepolia.zamapay-api.env -- cargo run -p api

# Start the ZamaPay web app for Sepolia contracts.
web-sepolia-local-ui: clean-zamapay-web-cache
    scripts/run-with-env.sh env/sepolia.zamapay-web.env -- mise exec -- npm --workspace apps/web run dev -- --hostname 127.0.0.1 --port 3001

# Start CardForge backend for a Sepolia ZamaPay project.
cardforge-api-sepolia-local-ui:
    scripts/run-with-env.sh env/sepolia.cardforge-backend.env env/supabase.cardforge-backend.env -- cargo run --manifest-path demo/cardforge/backend/Cargo.toml

# Start CardForge frontend for Sepolia local UI.
cardforge-web-sepolia-local-ui: clean-cardforge-web-cache
    scripts/run-with-env.sh env/sepolia.cardforge-frontend.env -- mise exec -- npm --prefix demo/cardforge/frontend run dev -- --hostname 127.0.0.1 --port 3002

# Validate public preview config before deploy.
preview-check:
    mise exec -- node scripts/verify-runtime-profile.js sepolia-preview
