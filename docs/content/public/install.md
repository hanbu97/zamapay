---
title: "Install ZamaPay"
description: "Install the ZamaPay CLI, server SDK preview, and agent skill without exposing merchant secrets."
badge: "Install"
icon: "terminal"
group: "Start"
order: 15
featured: true
---

## Install paths

ZamaPay has three integration surfaces:

- The CLI controls project setup, rails, secrets, webhooks, checkout sessions, balances, and guarded operational actions.
- The server SDK preview lets merchant backends create and retrieve hosted checkout sessions.
- The agent skill gives Codex or another coding agent the same guardrails as the docs: explicit `paymentRail`, server-only `ZAMAPAY_SECRET_KEY`, and raw-body webhook verification.

Prebuilt CLI releases are not published yet. The public install endpoints exist now so docs, agents, and future release automation can point at stable URLs without changing the integration shape later.

## CLI

For source checkouts, install the local CLI from the repository:

```bash
cargo install --path crates/cli --locked
zamapay --help
```

The public installer is already reserved. Until prebuilt binaries are published, pass `--from-source`:

```bash
bash <(curl -fsSL https://zamapay.org/install.sh) --from-source /path/to/zamapay --yes
```

After release, the same endpoint can install the prebuilt CLI:

```bash
bash <(curl -fsSL https://zamapay.org/install.sh) --yes
```

Planned npm wrapper:

```bash
npm install -g @zamapay/cli
```

## Agent skill

Install the ZamaPay skill into Codex:

```bash
bash <(curl -fsSL https://zamapay.org/.well-known/skills/zamapay/install.sh) --yes
```

The CLI can install the same skill from either the public endpoint or a local source file:

```bash
zamapay setup agent --yes
zamapay setup agent --source-file skills/zamapay/SKILL.md --target-dir .codex/skills/zamapay --yes
```

The skill does not store secrets. It teaches agents to keep `ZAMAPAY_SECRET_KEY` server-side, require explicit rail selection, and verify webhooks from the exact raw request bytes.

## Server SDK

Install the Node server SDK preview in a merchant backend:

```bash
npm install @zamapay/server
```

Use it only on the server:

```ts
import { ZamaPayClient } from "@zamapay/server"

const client = new ZamaPayClient({
  apiUrl: process.env.ZAMAPAY_API_URL,
  secretKey: process.env.ZAMAPAY_SECRET_KEY,
})
```

Browser code should redirect buyers to hosted checkout. It must not import the server SDK or read merchant secrets.

## Agent entrypoints

Agents should read these URLs before editing a merchant integration:

```text
https://zamapay.org/llms.txt
https://zamapay.org/llms-full.txt
https://zamapay.org/docs/manifest.json
https://zamapay.org/.well-known/zamapay.json
https://zamapay.org/.well-known/skills/index.json
https://zamapay.org/.well-known/skills/zamapay
```

`/.well-known/zamapay.json` is the stable integration manifest. It points to docs, install scripts, package names, skill URLs, and the current production guardrails.

## Verification

For this repository, keep install and agent surfaces honest with the normal workflow:

```bash
just docs-check
just verify-cli-shape
```

`docs-check` verifies AI-readable docs and skill text. `verify-cli-shape` verifies the CLI commands, including agent setup help, without requiring a deployed API.
