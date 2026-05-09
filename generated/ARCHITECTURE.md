# Generated Architecture

## Tree

```text
generated
|-- clients/
|   |-- ts/contracts.ts
|   `-- rust/contracts.rs
`-- contracts/
    |-- abi/*.json
    `-- addresses/local-dev.json
```

## Decisions

- `generated/*` is the only cross-runtime contract truth consumed by the app.
- Hardhat artifact paths stay private to `contracts/`; every other layer reads copied ABI and the local-dev address manifest from here.
- Sync exposes only the local-dev manifest and active private checkout contracts so stale generated clients cannot reintroduce old paths.
- Billing terms flow from deployed subscription contract constants into the generated manifest, then into Rust/UI projections.
