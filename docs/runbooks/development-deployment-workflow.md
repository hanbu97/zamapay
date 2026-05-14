# Development And Deployment Workflow

## Purpose

This is the workflow contract for ZamaPay and CardForge development. Use it before inventing shell commands, adding new env files, or changing deployment behavior.

The stable entrypoints are:

- `Justfile` for human and agent commands.
- `.mise.toml` for Node/npm and command-runner tooling.
- `env/runtime-profiles.json` for runtime shape.
- `env/*.env.example` for process env contracts.
- ignored same-name `env/*.env` files for local secrets.

Rust is not managed by mise in this repo. Keep using the workspace Rust toolchain.

## Bootstrap

Install the command runners once on macOS:

```bash
brew install mise just
```

Then initialize the workspace from the repo root:

```bash
mise trust
mise install
just doctor
just setup
```

`just setup` installs root Node dependencies, installs the standalone CardForge frontend dependencies, and syncs generated CardForge runtime snapshots.

## Rules

- Start with `just --list`.
- Prefer `just` recipes over raw `npm`, `cargo`, `docker`, Hardhat, or `set -a; . env/...` command sequences.
- Add a new `just` recipe when an operation becomes repeatable.
- Keep runtime defaults in `env/runtime-profiles.json`.
- Keep process-specific values in `env/*.env.example`.
- Never commit same-name `env/*.env` files.
- Run `just clean-local-dev` after branch churn, runtime-profile changes, env changes, or visual/CSS cache confusion.
- Local API workflows default to `127.0.0.1:18080`. Set `ZAMAPAY_LOCAL_API_PORT=<port>` on every related `just` command in a run when that port is not available.

## Local Development

Start local infrastructure:

```bash
just db-up
just contracts-node
```

In another terminal, reset chain-coupled local state:

```bash
just reset-local
```

`just reset-local` recreates both local databases, redeploys local contracts, refreshes generated clients, and clears local web caches. Run it after every Hardhat Local reset before starting API, web, or CardForge services.

Start ZamaPay:

```bash
just api-local
just evm-indexer-local
just web-local
```

`just api-local`, `just web-local`, `just cardforge-api-local`, `just verify-local`, and `just verify-full` share `ZAMAPAY_LOCAL_API_PORT`; use one value for the whole local stack.

`just evm-indexer-local` watches backend-owned EVM payment intents. The worker reads `/api/operator/evm/watchlist`, scans each chain/token/receiver from the stored cursor with a small reorg window, posts ERC20 `Transfer` evidence to `/api/operator/evm/transfers`, then advances `/api/operator/evm/cursors`.

Useful EVM rail knobs:

- `ZAMAPAY_EVM_INDEXER_FROM_BLOCKS` controls the first scan window before a cursor exists.
- `ZAMAPAY_EVM_INDEXER_REORG_WINDOW_BLOCKS` controls how many blocks are rescanned after the cursor.
- `ZAMAPAY_LOCAL_EVM_RECEIVER_ADDRESS` pins local-dev to one receiver; when unset, local-dev seeds a small deterministic receiver pool for concurrent checkout tests.

Start CardForge:

```bash
just cardforge-api-local
just cardforge-web-local
```

Run the fast local gate after Hardhat, API, and web are running:

```bash
just verify-local
```

Run the ordinary ERC20 rail gate after Hardhat, API, and web are running:

```bash
just verify-evm-local
```

This is the local production-shape proof for the non-private EVM rail. It signs in with the local merchant key, creates a project secret, creates an `evm_erc20` checkout without `chainInvoiceId` or `chainTxHash`, verifies the hosted checkout page, transfers exact local USDT from a Hardhat buyer account to the leased receiver, runs one indexer pass, then checks public checkout truth and merchant EVM balances.

Use this variant when you need a browser checkpoint before the buyer transfer:

```bash
just verify-evm-local --prepare-only
```

Open the printed `checkoutUrl`. The buyer entry is `http://127.0.0.1:3001/checkout/{checkoutSessionId}` and must show:

- `ERC20 hosted checkout`
- amount due
- network, token, receiver address, status, and expiry
- `Copy address`
- `Refresh status`
- `Pay ERC20 transfer`

Run the heavier gate when preparing a handoff:

```bash
just verify-full
```

Run the full code-quality gate before broad commits or release branches:

```bash
just check
just build-web
```

## CardForge Project Binding

CardForge is a standalone merchant demo. It does not own ZamaPay merchant state. It needs one project secret export in `env/local-dev.cardforge-backend.env`: `ZAMAPAY_SECRET_KEY`. The `zms_test_...` value authenticates checkout creation and lets CardForge call `/api/project-secret/bootstrap` to fetch project id plus current webhook verifier context at startup. Invalid placeholders must fail closed. `ZAMAPAY_API_URL` is deployment runtime config and stays in the env template because it is shared by every project on that deployment. `ZAMAPAY_SECRET_ENCRYPTION_KEY` belongs only to the ZamaPay API process and is required outside local-dev/test. Webhook receivers must verify `svix-id`, `svix-timestamp`, and `svix-signature` against the raw request body before parsing JSON.

Automated local seed path:

```bash
just seed-cardforge-local-project
```

This uses the local dev signer to create a ZamaPay project and update the ignored CardForge backend env file.

Manual browser path:

1. Open `http://127.0.0.1:3001/merchant`.
2. Sign in with the merchant wallet.
3. Create a payment project.
4. Copy the one-time `ZAMAPAY_SECRET_KEY` export.
5. Put that value into `env/local-dev.cardforge-backend.env`; leave `ZAMAPAY_API_URL` and CardForge-owned database/store values in the env template.
6. Restart `just cardforge-api-local`.

The manual path is the right proof when testing that the merchant wallet can later withdraw. The project owner must match the MetaMask account used on the merchant console.

## Browser Payment E2E

For local-dev Zama private browser testing:

1. MetaMask must be on Hardhat Local chain `31337`.
2. Buyer wallet must have local ETH for gas.
3. Buyer wallet must claim local mock cUSDT from CardForge.
4. CardForge creates a hosted checkout through its backend.
5. ZamaPay checkout asks the buyer wallet to submit encrypted payment.
6. ZamaPay finalizes the private payment and dispatches the Svix-style signed webhook.
7. CardForge releases the card.
8. Merchant project overview shows paid gross, fee, and withdrawable balance.
9. Merchant wallet signs `PrivateWithdraw`.
10. Project balance falls to zero and a completed withdrawal appears in balance activity.

Use UI evidence plus backend evidence. At minimum, record the checkout id, chain invoice id, payment tx, webhook delivery status, withdrawal id, and withdrawal receipt.

For local-dev ordinary ERC20 rail testing:

1. Keep Hardhat, Postgres, API, web, and `just evm-indexer-local` running.
2. `just reset-local` must have run after the latest contract changes so generated manifest includes local USDT/USDC mock addresses.
3. Run `just verify-evm-local --prepare-only` for the fastest local checkout seed, or have a merchant backend create a checkout with `paymentRail: "evm_erc20"`, `evmChainId: 31337`, and `evmTokenSymbol: "USDT"` or `"USDC"`; it must not send `chainInvoiceId` or `chainTxHash`.
4. Hosted checkout renders the platform payment intent: network, token, exact amount, leased receive address, expiry, and copy/wallet transfer actions.
5. Buyer wallet claims local standard ERC20 test tokens from the token mock if needed, then sends the exact amount to the assigned receiver.
6. The EVM indexer observes `Transfer(address indexed from,address indexed to,uint256 value)`, posts `/api/operator/evm/transfers`, and Rust matches by chain id, token contract, receiver, and amount semantics.
7. Merchant project overview shows the checkout as paid only for exact transfers that satisfy finality; underpay, overpay, duplicate, expiry, and reorg evidence remains visible in the ERC20 transfer ledger and balance exceptions.

ERC20 rail evidence is checkout id, payment intent id, token contract, receiver id/address, transfer tx hash/log index, block hash, matched intent id, confirmation count, and indexer cursor. Do not use `/api/operator/chain-invoices/*/payment-projection` for ERC20 payment truth.

## Supabase Local Run

Use Supabase for Postgres while keeping the local Hardhat chain:

```bash
just api-supabase-local
just cardforge-api-supabase-local
```

The later env file wins. The Supabase override should change only the database URL.

## Sepolia Local UI

Sepolia local-UI uses real Sepolia contracts and local API/web processes.

Prepare env files:

```bash
cp env/sepolia.contracts.env.example env/sepolia.contracts.env
cp env/supabase.zamapay-api.env.example env/supabase.zamapay-api.env
cp env/supabase.cardforge-backend.env.example env/supabase.cardforge-backend.env
cp env/sepolia.cardforge-backend.env.example env/sepolia.cardforge-backend.env
```

Validate and deploy:

```bash
just verify-runtime sepolia-local-ui
just deploy-sepolia-contracts
```

Start services:

```bash
just api-sepolia-local-ui
just web-sepolia-local-ui
just cardforge-api-sepolia-local-ui
just cardforge-web-sepolia-local-ui
```

Sepolia browser FHE operations use Zama's official test relayer through `@zama-fhe/relayer-sdk`. Do not replace that with a ZamaPay-owned relayer in this MVP.

## Public Preview

Before preview deployment:

```bash
just preview-check
just build-web
```

`preview-check` validates the public runtime profile shape. Public preview values must be explicit HTTPS/public RPC values, not localhost fallbacks.

## Recovery

Use these paths before debugging deeper:

| Symptom | First recovery |
| --- | --- |
| Browser UI looks stale after branch or env changes | `just clean-local-dev`, then restart the web recipe. |
| Chain addresses mismatch generated clients | Keep Hardhat running, then `just reset-local`. |
| CardForge points at an old project | Update ignored CardForge backend env, then restart `just cardforge-api-local`. |
| Sepolia/local-UI accidentally reads local-dev manifest | Check `NEXT_PUBLIC_RUNTIME_PROFILE`, then run `just verify-runtime sepolia-local-ui`. |
| Rust integration tests fail from missing database | `just db-up`, then rerun through `just check` or `just rust-test`. |
| ERC20 checkout payment never confirms | Check `just evm-indexer-local`, `/api/operator/evm/watchlist`, `/api/operator/evm/cursors`, token contract address, leased receiver address, exact minor-unit amount, and ledger exception status. |

## Documentation Contract

When changing the workflow:

1. Update the relevant `just` recipe or env helper first.
2. Update `env/README.md` if env ownership changes.
3. Update this runbook if command order changes.
4. Update the root `README.md` only for the high-level path.
5. Update `docs/runbooks/ARCHITECTURE.md` when runbook structure changes.
