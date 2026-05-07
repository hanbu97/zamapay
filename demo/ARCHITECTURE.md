# Demo Architecture

## Tree

```text
demo
`-- cardforge/ # Independent merchant demo app configured to call Mermer Pay
```

## Decisions

- Demo projects are separate applications, not routes inside the Mermer Pay platform.
- Each demo consumes Mermer Pay through configuration and HTTP boundaries only.
- Demo code must not import `apps/web`; shared behavior belongs in platform APIs or a future SDK, not path coupling.
