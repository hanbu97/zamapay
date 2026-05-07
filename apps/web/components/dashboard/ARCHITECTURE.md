# Dashboard Components Architecture

## Tree

```text
apps/web/components/dashboard
|-- SettlementDecryptCard.tsx   # Merchant wallet settlement user decrypt
`-- ARCHITECTURE.md             # This map
```

## Decisions

- `SettlementDecryptCard` owns merchant plaintext viewing; it does not let dashboard data become the plaintext source of truth.
- Dashboard components do not create merchant checkouts; checkout creation lives behind project API keys so merchant templates stay separate from the platform console.
- Components compose shadcn form, card, table, alert, badge, select, and button primitives instead of creating dashboard-only UI widgets.
