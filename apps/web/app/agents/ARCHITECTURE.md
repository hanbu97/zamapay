# Agents Route Architecture

## Tree

```text
apps/web/app/agents
|-- page.tsx          # Public landing page for agent install, llms, skill, manifest, and package entrypoints
`-- ARCHITECTURE.md   # Route note
```

## Decisions

- `/agents` is human-readable glue for machine-readable integration surfaces; it does not duplicate docs prose.
- The page links to stable public installer URLs and package names while keeping unpublished CLI binaries marked as source-mode only.
- The route never reads merchant credentials; it only reads optional session state for shared public navigation.
