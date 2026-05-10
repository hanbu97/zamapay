# Public Asset Architecture

## Tree

```text
apps/web/public
|-- ARCHITECTURE.md
|-- kms_lib_bg.wasm
|-- landing/
|-- tfhe_bg.wasm
`-- workerHelpers.js
```

## Decisions

- The public-testnet browser relayer UMD bundle is removed from the active app.
- The wasm/worker files stay as inert protocol assets for future official SDK work; the current local-dev payment path uses Hardhat/FHEVM RPC helpers and does not load a ZamaPay-owned relayer.
