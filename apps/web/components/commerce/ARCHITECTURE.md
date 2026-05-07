# Commerce Components Architecture

## Tree

```text
apps/web/components/commerce
`-- StatusBadge.tsx # Converts backend payment/finality strings into one shadcn Badge policy
```

## Decisions

- Commerce components hold reusable merchant-payment presentation rules, not API fetches or wallet behavior.
- `StatusBadge` centralizes status variants, including webhook and decrypt callback statuses, so pages do not grow their own color/status branches.
