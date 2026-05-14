---
title: "Development"
description: "Use the same workflow for local builds, API versioning, SDK smoke tests, docs checks, and deployment preview validation."
badge: "Workflow"
icon: "clipboard"
group: "Start"
order: 20
featured: true
---

## Toolchain contract {% #toolchain-contract %}

Start every local change from the Justfile. It is the human and agent entrypoint for setup, reset, local services, public-testnet local UI, deployment composition, and verification.

```bash
mise trust
mise install
just --list
just setup
just doctor
```

Rust is intentionally not managed by `mise` in this workspace. Node, npm, and command-runner versions come from `.mise.toml`; runtime shape comes from `env/runtime-profiles.json`; process secrets live in ignored same-name `env/*.env` files.

## API versions {% #api-versions %}

Merchant API clients send a fixed preview version header:

```http
ZamaPay-Version: 2026-05-14
```

The server SDK sends this header by default. Raw HTTP integrations must send it explicitly. A missing version is allowed only for internal browser routes that already share the deployed frontend and API contract.

{% callout title="Why the date version exists" %}
Payment rails have different truth sources. Date-versioned merchant APIs let ZamaPay evolve checkout responses, settlement intent details, and webhook payloads without changing the meaning of old server integrations by accident.
{% /callout %}

## Verification gates {% #verification-gates %}

Run the smallest gate that proves the changed surface, then run the broader gate before handoff.

| Change surface | Primary command | What it proves |
| --- | --- | --- |
| Public docs content or docs routing | `just docs-check` | Markdoc parses, frontmatter is valid, slugs and sections are unique. |
| Server SDK package | `just build-sdk` and `just verify-sdk-install-shape` | Published ESM/CJS/import/type/webhook shapes still work. |
| Local merchant API and hosted checkout | `just verify-local` | API, Next pages, dashboard auth, and hosted checkout rendering are alive. |
| Ordinary ERC20 rail | `just verify-evm-local` | Checkout creation, settlement contract payment, indexer finality, and merchant balances agree. |
| Broad release branch | `just check` and `just build-web` | SDK, web, contracts, Rust tests, and app build pass together. |

## Documentation workflow {% #documentation-workflow %}

Public documentation content lives under `docs/content/public/*.md`. The Next.js docs route reads those Markdoc files directly. Do not reintroduce page copy in TypeScript data arrays.

When a runtime, credential, webhook, SDK, rail, or deployment contract changes, update the matching Markdoc page and the relevant internal runbook in the same patch.

```bash
just docs-check
npm --workspace apps/web run lint
```
