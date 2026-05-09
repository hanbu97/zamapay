# Commerce Components Architecture

## Tree

```text
apps/web/components/commerce
|-- StatusBadge.tsx   # Converts backend payment/finality strings into one shadcn Badge policy
`-- StatusStepper.tsx # Converts business process state into one ReUI Stepper policy
```

## Decisions

- Commerce components hold reusable merchant-payment presentation rules, not API fetches or wallet behavior.
- `StatusBadge` centralizes status variants, including webhook, key, endpoint, checkout, and decrypt callback statuses, so pages do not grow their own color/status branches.
- `StatusStepper` wraps the ReUI registry stepper as read-only progress; merchant setup uses vertical all-detail mode, while checkout can use horizontal active-detail mode.
