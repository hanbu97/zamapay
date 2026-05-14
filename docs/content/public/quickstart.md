---
title: "Quickstart"
description: "Create a payment project, keep one server-side project secret, and create hosted checkout sessions with an explicit payment rail."
badge: "Start here"
icon: "book-open"
group: "Start"
order: 10
featured: true
---

## The shortest correct path {% #project-first %}

ZamaPay starts from a merchant payment project. The browser console creates the project and reveals one server-side project secret once. The merchant backend uses that secret to create checkout sessions and bootstrap webhook verifier context.

The buyer-facing hosted checkout URL is returned only after ZamaPay has created rail-specific payment truth: a Zama private invoice or an ordinary EVM ERC20 settlement intent.

1. Open `/docs`, then open the merchant console when you are ready to configure a real project.
2. Create a project with `local-dev`.
3. Add the merchant backend webhook URL during creation when possible.
4. Copy only the one-time `ZAMAPAY_SECRET_KEY` export into the merchant backend secret store.
5. Create hosted checkout sessions from the backend. The merchant frontend must never call project checkout creation with a dashboard cookie.

{% figure kind="project-console" /%}

{% callout title="Credential shape" %}
`ZAMAPAY_API_URL` is shared deployment configuration. The project-specific server credential is `ZAMAPAY_SECRET_KEY`. Project id and webhook verifier context are bootstrapped by the backend from `/api/project-secret/bootstrap`.
{% /callout %}

## Local stack {% #local-stack %}

Use these services for the deterministic closed loop. After every Hardhat Local reset, run the root reset command once so the ZamaPay and CardForge databases match the fresh chain.

Environment files live under `env/`: commit only `*.env.example`, keep same-name `.env` files local, and use `just` recipes to compose them.

```bash
# Terminal 0
just db-up
just contracts-node

# Terminal 1
just reset-local
just api-local

# Terminal 2
just evm-indexer-local

# Terminal 3
just web-local

# Terminal 4
just cardforge-api-local
just cardforge-web-local
```

## Supabase overrides {% #supabase-overrides %}

Supabase changes the Postgres host, not the local-dev chain. The `just` recipes source local-dev first and the Supabase override second so only the database URL is replaced.

```bash
# ZamaPay API with Supabase Postgres
just api-supabase-local

# CardForge backend with Supabase Postgres
just cardforge-api-supabase-local
```
