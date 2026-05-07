# Apps Architecture

## Scope

- `web/` is the Mermer Pay platform application: merchant console, hosted checkout, wallet login, and operator diagnostics.
- Merchant demo products live under root `demo/`, not under `apps/`.
- Future platform apps must not bypass the Rust session boundary or generated contract clients.
