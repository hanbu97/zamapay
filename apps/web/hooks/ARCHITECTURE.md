# Hooks Architecture

## Tree

```text
apps/web/hooks
`-- use-mobile.ts # shadcn responsive breakpoint hook used by Sidebar
```

## Decisions

- Hooks in this directory support UI primitives, not payment business state.
- `use-mobile.ts` stays aligned with the shadcn sidebar implementation because mobile/off-canvas behavior depends on the same breakpoint contract.
