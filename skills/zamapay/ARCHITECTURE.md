# ZamaPay Agent Skill Architecture

## Tree

```text
zamapay
|-- SKILL.md          # Agent-facing integration rules and workflow
|-- ARCHITECTURE.md   # This boundary note
`-- agents/
    `-- openai.yaml   # UI metadata for skill lists
```

## Decisions

- `SKILL.md` stays short so agents can load it before editing merchant code.
- The skill points agents to `llms.txt`, docs markdown pages, and the Rust `zamapay` CLI instead of duplicating the full API reference.
- ERC20 rail guidance names `EvmPaymentAccepted` as the only payment truth, treats the relayer as a gas-paying facilitator, prefers USDC/EURC EIP-3009, requires USDT Permit2 witness funding, and bans plain Permit2 transfer so agents preserve the settlement-ledger boundary.
- Human confirmation is mandatory for withdrawal, delivery resend, project-secret revoke, and webhook secret rotation because those actions move money, replay external effects, or invalidate deployed receivers.
