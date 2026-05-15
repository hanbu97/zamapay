# ZamaPay Integration Manifest Route Architecture

## Tree

```text
apps/web/app/.well-known/zamapay.json
|-- route.ts          # Public JSON manifest for docs, package, installer, and skill discovery
`-- ARCHITECTURE.md   # Route note
```

## Decisions

- The manifest is generated from `docs-content.ts` so AI docs, skill discovery, and install URLs share one source.
- The route exposes no credentials and no merchant-specific state.
- Release status is explicit: CLI prebuilt artifacts are planned, while source-mode installation is the current supported preview path.
