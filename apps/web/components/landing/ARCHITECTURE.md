# Landing Components Architecture

## Tree

```text
apps/web/components/landing
`-- LandingProductMotion.tsx # Homepage checkout rail animation and interactive step selector
```

## Decisions

- Landing components can be visually rich, but they must not become payment logic.
- `LandingProductMotion` is a client island because it owns timed step state and user-controlled step switching.
- The component displays product-state screenshots and simulated checkout state; real invoice creation stays in protected merchant pages.
