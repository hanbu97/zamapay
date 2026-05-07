# Generated Architecture

## Tree

```text
generated
|-- clients/
|   |-- ts/contracts.ts            # Frontend-facing ABI and address manifest exports
|   `-- rust/contracts.rs          # Rust-facing ABI and address manifest constants
`-- contracts/
    |-- abi/*.json                 # Canonical ABI snapshots copied from Hardhat artifacts
    `-- addresses/*.json           # Environment manifests such as local-dev.json and sepolia.json
```

## Decisions

- `generated/*` is the only cross-runtime contract truth consumed by the app.
- Hardhat artifact paths stay private to `contracts/`; every other layer reads copied ABI and address manifests from here.
- Address manifests are additive by environment; syncing ABI must not erase a deployed environment address book.
- Settlement ABI changes are propagated here first, including exact-amount invoice creation, payment-check events, and finalization calls.
