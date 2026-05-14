# Packages Architecture

## Tree

```text
packages/
`-- zamapay-server/        # Preview server-side TypeScript SDK for merchant backends
```

## Decisions

- Root packages are server/runtime libraries, not browser bundles.
- SDK packages consume shared contract fixtures from `fixtures/merchant-api` so examples, tests, and docs do not fork protocol truth.
- Browser and mobile SDKs are out of scope until the server SDK contract settles.
