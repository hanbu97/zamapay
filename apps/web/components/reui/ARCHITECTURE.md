# ReUI Component Architecture

## Tree

```text
apps/web/components/reui
`-- stepper.tsx # Registry stepper primitive for vertical process state and descriptions
```

## Decisions

- Files here are registry-owned UI primitives installed through `npx shadcn@latest add @reui/...`.
- Business pages must not import process rules into this folder; they wrap registry primitives through `components/commerce`.
- `stepper.tsx` stays generic. Payment and setup semantics live in `commerce/StatusStepper.tsx`; the vertical separator reads the product step spacing token instead of hard-coding the registry's tall default.
