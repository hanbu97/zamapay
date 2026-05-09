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
- The wasm/worker files stay for future relayer work, but the current local-dev payment path uses server-side Hardhat/FHEVM helpers instead of loading browser relayer code.
