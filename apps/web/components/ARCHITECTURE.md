# Components Architecture

## Tree

```text
apps/web/components
|-- auth/
|   `-- LoginCard.tsx               # Wallet nonce/signature login client
|-- checkout/
|   `-- CheckoutPaymentCard.tsx     # Buyer encrypted payment client
|-- commerce/
|   `-- StatusBadge.tsx             # Shared payment/finality status badge
|-- dashboard/
|   `-- SettlementDecryptCard.tsx   # Merchant wallet user-decrypt client
|-- landing/
|   `-- LandingProductMotion.tsx    # Public homepage interactive checkout rail
|-- layout/
|   |-- AppSidebar.tsx              # shadcn sidebar shell and navigation
|   |-- PageHeader.tsx              # Shared page title/action composition
|   `-- TopBar.tsx                  # Breadcrumb and top action bar
|-- merchant/
|   |-- MerchantPortalUnavailable.tsx # Protected project API unavailable state
|   `-- PaymentProjectConsole.tsx   # Project-scoped keys, checkout sessions, webhooks, and diagnostics
`-- ui/
    |-- alert.tsx                   # shadcn notice primitive
    |-- avatar.tsx                  # shadcn identity mark primitive
    |-- badge.tsx                   # shadcn status primitive
    |-- breadcrumb.tsx              # shadcn location hierarchy primitive
    |-- button-group.tsx            # shadcn grouped command primitive
    |-- button.tsx                  # shadcn command primitive
    |-- card.tsx                    # shadcn surface primitive
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
- `LoginCard` detects wallet providers only after mount and after `ethereum#initialized`, keeping SSR markup stable while supporting late wallet injection.
- Checkout payment uses the invoice read-model amount, encrypts token approval and settlement payment through the Zama relayer SDK, publicly decrypts the encrypted accept/reject handle, then finalizes the settlement contract.
- Dashboard settlement decrypt reads the encrypted settlement handle and requires merchant wallet EIP-712 authorization before any plaintext amount appears.
- `ui/` is generated shadcn infrastructure. It owns appearance and accessibility defaults, never merchant payment state.
- Feature components compose `Sidebar`, `Tabs`, `Card`, `Field`, `InputGroup`, `Select`, `Progress`, `Table`, `Alert`, `Item`, `ButtonGroup`, and `Button` directly so commercial back-office screens stay simple, dense, and predictable.
- `commerce/StatusBadge.tsx` is the only status styling policy; pages pass raw backend status strings and do not create local status color branches.
- `layout/AppSidebar.tsx` owns payment-platform navigation so individual pages stay content-only.
- `merchant/PaymentProjectConsole.tsx` is the platform control plane: it configures projects, API keys, webhook endpoints, delivery retries, and checkout read models without importing CardForge-specific state.
- `merchant/MerchantPortalUnavailable.tsx` keeps stale local API or missing project endpoint failures inside the product UI instead of leaking framework overlays.
- The shadcn registry stays flat by design even when it has more than eight primitive files; preserving CLI update compatibility is more valuable than hand-splitting generated primitives.
