# ZamaPay CLI Architecture

## Tree

```text
crates/cli
|-- Cargo.toml
|-- ARCHITECTURE.md
`-- src/
    |-- auth.rs         # EVM private-key nonce signing for CLI login
    |-- client.rs       # Versioned HTTP client for project-secret and control-session APIs
    |-- common.rs       # Shared CLI validation, output, env, and checkout request helpers
    |-- config.rs       # ~/.zamapay/config.json, owner session, and cwd project links
    |-- control_ops.rs  # Login, project, rail, and project-secret control-plane commands
    |-- lib.rs          # Clap command contract and top-level dispatch
    |-- main.rs         # Thin async clap entrypoint
    |-- merchant_ops.rs # Webhook, checkout, event, delivery, balance, and withdraw commands
    `-- setup_ops.rs   # Local helper installation, including Codex skill setup
```

## Decisions

- The binary name is `zamapay`; the package name is `zamapay-cli` so it does not collide with the workspace or future SDK crates.
- The CLI depends on `shared` DTOs instead of redefining checkout request/response shapes.
- Webhook commands reuse `webhook-verifier`; raw-body HMAC logic must not be copied.
- Control-plane commands use the existing wallet nonce protocol. The CLI signs the nonce locally with an EVM private key and stores only the resulting ZamaPay session id in `~/.zamapay/config.json`.
- Project-secret commands remain separate from control-plane commands. `ZAMAPAY_SECRET_KEY` creates checkout sessions; the wallet session manages projects, rails, endpoint secrets, deliveries, balances, and withdrawal projections.
- `zamapay assets` prints the same catalog capabilities that checkout uses, including ranked ERC20 funding methods, so CLI users do not guess EIP-3009, Permit2, ERC-2612, or approve/pay support from token symbols.
- Setup commands are local bootstrap helpers. They may install docs/skill material, but they must not authenticate, mutate projects, or read merchant secrets.
- Webhook secret rotation, delivery resend, project-secret revoke, and withdraw commands exist, but each requires `--yes`. The CLI must never move money or rotate verifier material silently.
