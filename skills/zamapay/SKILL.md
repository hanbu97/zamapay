---
name: zamapay
description: Use when integrating ZamaPay hosted checkout, ordinary EVM ERC20 payments, Zama private payments, raw-body webhooks, or the ZamaPay server SDK/CLI into a merchant backend. Enforces server-only secrets, explicit paymentRail, rail-specific payment truth, and human confirmation for withdraw, delivery resend, project secret revoke, or webhook secret rotation.
metadata:
  short-description: Integrate ZamaPay hosted payments
---

# ZamaPay Integration

Use this skill when adding ZamaPay to a merchant server, fixing a ZamaPay integration, or generating test code for checkout and webhooks.

## Install

Preferred public installer:

```bash
bash <(curl -fsSL https://zamapay.org/.well-known/skills/zamapay/install.sh) --yes
```

Local source checkout:

```bash
zamapay setup agent --source-file skills/zamapay/SKILL.md --target-dir .codex/skills/zamapay --yes
```

## Hard Rules

- Keep `ZAMAPAY_SECRET_KEY` and `whsec_...` values on the merchant server only. Never put them in browser code, mobile bundles, or `NEXT_PUBLIC_*`.
- Every checkout create request must pass `paymentRail` explicitly: `evm_erc20` or `zama_private`.
- Verify webhook signatures against the exact raw request body before JSON parsing. A parsed object is not a valid webhook body.
- Do not mix payment truth across rails. `evm_erc20` is finalized by ERC20 settlement events; `zama_private` is finalized by the private checkout rail.
- Withdrawals, delivery resend, project secret revoke, and webhook secret rotation require explicit human confirmation. CLI commands for these operations must include `--yes`.
- Do not store owner private keys in source files. Use `zamapay login --private-key-stdin` or a CI secret, then use the stored local control session.

## Workflow

1. Read `https://zamapay.org/llms.txt` or the local `/llms.txt` route for the current docs map.
2. Choose the right authority lane:
   - Merchant control-plane configuration: `zamapay login`, then `zamapay project`, `rail`, `secret`, `webhook`, `delivery`, `balance`, or `withdraw`.
   - Merchant runtime checkout creation: `ZAMAPAY_SECRET_KEY` through the server SDK or raw HTTP.
3. Choose one server integration surface:
   - TypeScript backend: `@zamapay/server`.
   - Other backends: raw HTTP from `/docs/raw-http-fallback.md`.
   - Deterministic local checks: Rust `zamapay` CLI.
4. Bootstrap project context with `ZAMAPAY_SECRET_KEY`; do not ask the browser for project credentials.
5. Create checkout sessions from the merchant backend only.
6. Store returned checkout/session ids in merchant order state.
7. Verify `svix-*` webhook headers from raw bytes before fulfillment.

## CLI Helpers

Use the Rust CLI for deterministic local actions:

```bash
zamapay doctor
zamapay login --private-key-stdin
zamapay setup agent --yes
zamapay project create --name "CardForge local" --link --create-secret
zamapay rail enable --payment-rail evm_erc20
zamapay webhook create --url http://127.0.0.1:8092/api/zamapay/webhook --export-env
zamapay checkout create --payment-rail evm_erc20 --merchant-order-id order_123 --title "Test order" --amount-label "10 USDT" --amount-minor-units 10000000 --evm-chain-id 31337 --evm-token-symbol USDT
zamapay verify-webhook --body-file webhook.json --svix-id msg_123 --svix-timestamp 1778760000 --svix-signature "v1,..." --secret "$ZAMAPAY_WEBHOOK_SECRET"
zamapay test-webhook --url http://127.0.0.1:8092/api/zamapay/webhook
```

## Refuse Bad Shapes

Stop and repair the integration if code:

- creates checkout sessions from frontend routes with public secrets,
- omits `paymentRail`,
- reserializes JSON before webhook verification,
- marks payment as paid from a webhook projection alone,
- exposes project id, webhook endpoint id, or `whsec_...` as browser configuration,
- performs withdraw, delivery resend, project secret revoke, or secret rotation without an explicit human action.
