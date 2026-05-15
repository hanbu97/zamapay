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
| Public docs content or docs routing | `just docs-check` | Markdoc parses, frontmatter is valid, slugs, sections, AI-readable outputs, and skill guardrails are covered. |
| Server SDK package | `just build-sdk` and `just verify-sdk-install-shape` | Published ESM/CJS/import/type/webhook shapes still work. |
| Rust merchant CLI | `just build-cli` and `just verify-cli` | The `zamapay` binary compiles and command helpers preserve rail and webhook safety rules. |
| Local merchant API and hosted checkout | `just verify-local` | API, Next pages, dashboard auth, and hosted checkout rendering are alive. |
| Ordinary ERC20 rail | `just verify-evm-local --funding-method all` | Checkout creation, all direct funding entrypoints, settlement event indexing, on-chain settlement balances, and merchant balances agree. |
| Gasless ERC20 facilitator | `just verify-evm-local --token USDC --funding-method relayed-eip3009` and `just verify-evm-local --token USDT --funding-method relayed-permit2` | Buyer signs once after any one-time Permit2 setup, the web relayer submits settlement, the indexer observes `EvmPaymentAccepted`, and dashboard balances agree. |
| Broad release branch | `just check` and `just build-web` | SDK, web, contracts, Rust tests, and app build pass together. |

## Documentation workflow {% #documentation-workflow %}

Public documentation content lives under `docs/content/public/*.md`. The Next.js docs route reads those Markdoc files directly. Do not reintroduce page copy in TypeScript data arrays.

When a runtime, credential, webhook, SDK, rail, or deployment contract changes, update the matching Markdoc page and the relevant internal runbook in the same patch.

The docs route also exposes AI-readable integration surfaces from the same source:

```text
/llms.txt
/llms-full.txt
/docs/manifest.json
/docs/{slug}.md
/.well-known/zamapay.json
/.well-known/skills/index.json
/.well-known/skills/zamapay
/.well-known/skills/zamapay/install.sh
/install.sh
```

`/llms.txt` is the compact agent entrypoint. `/llms-full.txt` is the full corpus. `/docs/{slug}.md` strips frontmatter and Markdoc-only UI tags so coding agents can cite one guide at a time. The well-known integration manifest points agents to docs, package names, install scripts, and skill URLs. The skill endpoint mirrors `skills/zamapay/SKILL.md` and must keep the server-only secret, explicit `paymentRail`, raw-body webhook, rail-truth, and human-confirmation rules intact.

```bash
just docs-check
npm --workspace apps/web run lint
```

## Agent integration surfaces {% #agent-integration-surfaces %}

Use these URLs when asking an agent to integrate ZamaPay into a merchant app:

| URL | Use |
| --- | --- |
| `/llms.txt` | Start here. It lists the public docs pages and the ZamaPay Skill URL. |
| `/llms-full.txt` | Use when the agent needs the whole public docs corpus in one fetch. |
| `/docs/manifest.json` | Use for structured navigation, page groups, Markdown URLs, and required guardrails. |
| `/docs/{slug}.md` | Use for one clean guide without Markdoc frontmatter or UI-only tags. |
| `/.well-known/zamapay.json` | Use for package names, install URLs, skill URLs, and top-level integration status. |
| `/.well-known/skills/index.json` | Use for skill discovery. |
| `/.well-known/skills/zamapay` | Use as the executable integration policy for skill-aware agents. |
| `/.well-known/skills/zamapay/install.sh` | Use for one-command Codex skill installation. |
| `/install.sh` | Use for CLI installation; source mode is active until prebuilt releases are published. |

The manifest guardrails are part of the contract. They must continue to say that project secrets stay server-side, checkout creation names `paymentRail`, webhooks verify raw bytes, EVM and Zama truth sources stay separate, and withdraw or secret rotation needs explicit human confirmation.

Before handoff, test the routes from a production Next build so absolute URLs use the request host:

```bash
just build-web
npm --workspace apps/web run start -- --hostname 127.0.0.1 --port 3011
curl -fsS http://127.0.0.1:3011/llms.txt
curl -fsS http://127.0.0.1:3011/docs/manifest.json
curl -fsS http://127.0.0.1:3011/.well-known/zamapay.json
curl -fsS http://127.0.0.1:3011/.well-known/skills/index.json
curl -fsS http://127.0.0.1:3011/.well-known/skills/zamapay/install.sh
curl -fsS http://127.0.0.1:3011/install.sh
```

## CLI workflow {% #cli-workflow %}

The Rust `zamapay` CLI is the merchant control-plane for local and scripted configuration. It has two authority lanes:

- Owner control session: `zamapay login` signs the normal wallet nonce with a local private key and stores only the resulting session id in `~/.zamapay/config.json`.
- Project runtime secret: `ZAMAPAY_SECRET_KEY` stays in the merchant backend and is used only for checkout creation, checkout lookup, quote, and bootstrap.

```bash
just build-cli
just verify-cli
cargo run -p zamapay-cli -- login --private-key-stdin
cargo run -p zamapay-cli -- setup agent --source-file skills/zamapay/SKILL.md --target-dir .codex/skills/zamapay --yes
cargo run -p zamapay-cli -- project create --name "CardForge local" --link --create-secret
cargo run -p zamapay-cli -- rail enable --payment-rail evm_erc20
cargo run -p zamapay-cli -- webhook create --url http://127.0.0.1:8092/api/zamapay/webhook --export-env
cargo run -p zamapay-cli -- checkout create --payment-rail evm_erc20 --merchant-order-id order_123 --title "Test order" --amount-label "10 USDT" --amount-minor-units 10000000 --evm-chain-id 31337 --evm-token-symbol USDT
cargo run -p zamapay-cli -- verify-webhook --body-file webhook.json --svix-id msg_123 --svix-timestamp 1778760000 --svix-signature "v1,..." --secret "$ZAMAPAY_WEBHOOK_SECRET"
cargo run -p zamapay-cli -- test-webhook --url http://127.0.0.1:8092/api/zamapay/webhook
```

Commands that revoke secrets, rotate webhook secrets, resend deliveries, or project withdrawals require `--yes`. Do not store owner private keys in repo files; pass them through stdin or a CI secret.

## ERC20 rail local proof {% #erc20-rail-local-proof %}

The ordinary ERC20 verifier accepts a funding method selector:

```bash
just verify-evm-local --funding-method approve-pay
just verify-evm-local --funding-method eip3009
just verify-evm-local --token USDC --funding-method relayed-eip3009
just verify-evm-local --funding-method permit2
just verify-evm-local --token USDT --funding-method relayed-permit2
just verify-evm-local --funding-method erc2612
just verify-evm-local --funding-method all
```

`relayed-eip3009` signs the EIP-3009 authorization with the buyer key, posts it to the same-origin Next.js facilitator, and waits for the relayer-submitted settlement transaction. Localhost local-dev can use the Hardhat account-0 relayer fallback; non-local profiles must set `ZAMAPAY_ENABLE_EVM_RELAYER=1` and `ZAMAPAY_EVM_RELAYER_PRIVATE_KEY`.

`relayed-permit2` is the required USDT local proof. The buyer wallet grants Permit2 token allowance once, signs the witness-bound checkout payment, and the relayer submits `payWithPermit2`. USDC local proof uses EIP-3009 instead, so the buyer does not need Permit2 for the best path.

`--funding-method all` creates separate checkouts for each direct method, submits each through `EvmCheckoutSettlement`, runs the settlement-event indexer, and reads `token.balanceOf(settlement)`, `merchantBalanceOf(projectId, token)`, and `platformBalanceOf(token)` directly from the chain. Add `--withdraw-proof` when the local web server is running and you need to prove the local withdrawal projection path.

The CLI exposes the same asset catalog used by checkout:

```bash
zamapay assets
```

Use the `funding=` column as the source of truth for EIP-3009, Permit2, ERC-2612, and approve/pay availability. Do not infer capabilities from token symbols.

The verifier intentionally does not listen to token `Transfer` logs as payment truth. It only accepts the indexed `EvmPaymentAccepted` event.
