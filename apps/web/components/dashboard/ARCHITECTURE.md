# Dashboard Components Architecture

## Tree

```text
apps/web/components/dashboard
`-- ARCHITECTURE.md
```

## Decisions

- The old merchant settlement decrypt card was removed with the transparent invoice settlement path.
- Dashboard components do not create merchant checkouts; checkout creation lives behind project secrets so merchant templates stay separate from the platform console.
