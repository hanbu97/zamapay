# Public Asset Architecture

## Tree

```text
apps/web/public
|-- ARCHITECTURE.md          # This map
|-- kms_lib_bg.wasm          # Zama relayer KMS wasm loaded by the hosted checkout browser bundle
|-- landing/                 # Static product imagery for marketing surfaces
|-- relayer-sdk-js.umd.js    # Zama relayer UMD bundle that attaches `window.relayerSDK`
|-- tfhe_bg.wasm             # Zama TFHE wasm loaded by the relayer bundle
`-- workerHelpers.js         # Relayer SDK worker helper fetched by the UMD runtime
```

## Decisions

- Hosted checkout pays from the browser, so Zama relayer assets live in `public` where the UMD runtime can fetch `/tfhe_bg.wasm`, `/kms_lib_bg.wasm`, and `/workerHelpers.js` directly.
- The app loads these assets only after the buyer clicks payment; initial render stays free of relayer wasm and worker cost.
