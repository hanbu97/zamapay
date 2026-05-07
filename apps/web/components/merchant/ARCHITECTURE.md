# Merchant Components Architecture

## Tree

```text
apps/web/components/merchant
`-- PaymentProjectConsole.tsx   # Project-scoped console for keys, webhooks, checkouts, and diagnostics
```

## Decisions

- Merchant components own platform configuration, not demo fulfillment logic.
- `PaymentProjectConsole` is a client island because project creation, key issuance, webhook tests, and manual resend are operator actions.
- API keys and webhook secrets are shown only from one-time creation responses; persisted UI uses prefixes and previews.
