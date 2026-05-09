# Components Architecture

## Tree

```text
apps/web/components
|-- auth/
|   `-- LoginCard.tsx               # Wallet nonce/signature login client
|-- checkout/
|   `-- CheckoutPaymentCard.tsx     # Centered buyer wallet payment card
|-- commerce/
|   |-- StatusBadge.tsx             # Shared payment/finality status badge
|   `-- StatusStepper.tsx           # Shared payment/setup progress policy
|-- dashboard/
|   `-- SettlementDecryptCard.tsx   # Merchant wallet user-decrypt client
|-- landing/
|   `-- LandingProductMotion.tsx    # Public homepage interactive checkout rail
|-- marketing/
|   |-- PublicHeader.tsx            # Public navbar with Docs menu, Pricing link, and session-aware CTA
|   `-- PublicFooter.tsx            # Public footer with product, docs, workspace, Zama, and social placeholder links
|-- layout/
|   |-- AppSidebar.tsx              # Account/project-aware shadcn sidebar shell and navigation
|   |-- PageHeader.tsx              # Shared page title/action composition
|   `-- TopBar.tsx                  # Current route breadcrumb and account logout menu
|-- merchant/
|   |-- MerchantPortalUnavailable.tsx # Protected project API unavailable state
|   |-- MerchantBillingOverview.tsx # Account subscription status and previous billing payments
|   |-- MerchantBillingPanel.tsx # Dedicated account subscription upgrade client and contract-state reader
|   |-- MerchantProjectsOverview.tsx # Account-scoped project inventory and onboarding
|   |-- PaymentProjectConsole.tsx   # Project-scoped keys, checkout sessions, webhooks, and diagnostics
|   `-- PaymentProjectConsoleParts.tsx # Console-only presentation helpers and formatting
|-- reui/
|   `-- stepper.tsx                 # ReUI registry stepper primitive
`-- ui/
    |-- alert.tsx                   # shadcn notice primitive
    |-- avatar.tsx                  # shadcn identity mark primitive
    |-- badge.tsx                   # shadcn status primitive
    |-- breadcrumb.tsx              # shadcn location hierarchy primitive
    |-- button-group.tsx            # shadcn grouped command primitive
    |-- button.tsx                  # shadcn command primitive
    |-- card.tsx                    # shadcn surface primitive
    |-- dialog.tsx                  # shadcn modal primitive
    |-- dropdown-menu.tsx           # shadcn menu primitive
    |-- empty.tsx                   # shadcn empty-state primitive
    |-- field.tsx                   # shadcn form layout primitive
    |-- input-group.tsx             # shadcn input composition primitive
    |-- input.tsx                   # shadcn text input primitive
    |-- item.tsx                    # shadcn dense list/item primitive
    |-- label.tsx                   # shadcn label primitive
    |-- progress.tsx                # shadcn readiness/progress primitive
    |-- select.tsx                  # shadcn select primitive
    |-- separator.tsx               # shadcn boundary primitive
    |-- sheet.tsx                   # shadcn mobile sidebar sheet primitive
    |-- sidebar.tsx                 # shadcn application shell primitive
    |-- skeleton.tsx                # shadcn loading placeholder primitive
    |-- spinner.tsx                 # shadcn pending-state primitive
    |-- table.tsx                   # shadcn data table primitive
    |-- tabs.tsx                    # shadcn segmented content primitive
    |-- textarea.tsx                # shadcn multiline input primitive
    `-- tooltip.tsx                 # shadcn hover disclosure primitive
```

## Decisions

- Client components are reserved for browser-owned actions: wallet signing and authenticated form submission.
- `landing/LandingProductMotion.tsx` is the one homepage client island; it owns visual step animation and does not create payment state.
- `marketing/PublicHeader.tsx` and `marketing/PublicFooter.tsx` are the public website chrome for home, docs, and pricing surfaces.
- `LoginCard` detects wallet providers after mount, silently reads `eth_accounts`, uses the first wallet-returned account as active, and disconnects by revoking this site's wallet permission so the user can switch accounts in the wallet before reconnecting.
- Checkout payment uses the invoice read-model amount, encrypts token approval and settlement payment through the Zama relayer SDK, publicly decrypts the encrypted accept/reject handle, then finalizes the settlement contract.
- Dashboard settlement decrypt reads the encrypted settlement handle and requires merchant wallet EIP-712 authorization before any plaintext amount appears.
- `ui/` and `reui/` are generated registry infrastructure. They own appearance and accessibility defaults, never merchant payment state.
- Feature components compose `Sidebar`, `Tabs`, `Card`, `Dialog`, `Field`, `InputGroup`, `Select`, `Progress`, `Table`, `Alert`, `Item`, `ButtonGroup`, `Button`, and `StatusStepper` directly so commercial back-office screens stay simple, dense, and predictable.
- `commerce/StatusBadge.tsx` is the only status styling policy; pages pass raw backend status strings and do not create local status color branches.
- `commerce/StatusStepper.tsx` is the only step-progress policy; checkout uses horizontal active-detail mode and merchant setup keeps vertical all-detail mode.
- `layout/TopBar.tsx` owns the compact account menu; it shows the current plan/avatar and sends logout through the Rust session boundary.
- `layout/AppSidebar.tsx` owns payment-platform navigation; it shows account-level entries before a project is opened and project-level entries under `/merchant/[projectId]`.
- `merchant/MerchantProjectsOverview.tsx` is the project inventory: it lists, filters, sorts, creates, and opens projects without mixing in billing or aggregate analytics.
- `merchant/MerchantBillingOverview.tsx` owns read-only billing status and previous subscription payments; it links to the dedicated upgrade flow instead of mutating state.
- `merchant/MerchantBillingPanel.tsx` owns account subscription upgrades, private Zama proof anchoring, and `PrivateSubscriptionRegistry` reads through the configured contract RPC; wallet prompts are reserved for decrypt/write actions.
- `merchant/PaymentProjectConsole.tsx` is the project control plane: it configures one project's API keys, webhook endpoints, delivery retries, checkout read model, and diagnostics without importing CardForge-specific state.
- `merchant/PaymentProjectConsoleParts.tsx` holds console-only leaf components and formatting so the control-plane component stays under the file-size guardrail.
- New-project onboarding hides the resource split by creating the default project API key immediately and showing one copy-required backend env bundle.
- `merchant/MerchantPortalUnavailable.tsx` keeps stale local API or missing project endpoint failures inside the product UI instead of leaking framework overlays.
- The shadcn registry stays flat by design even when it has more than eight primitive files; preserving CLI update compatibility is more valuable than hand-splitting generated primitives.
