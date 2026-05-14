# Components Architecture

## Tree

```text
apps/web/components
|-- auth/LoginCard.tsx
|-- checkout/CheckoutPaymentCard.tsx
|-- commerce/
|-- landing/
|-- marketing/
|-- layout/
|-- merchant/
|-- reui/
`-- ui/
```

## Decisions

- Client components are reserved for browser-owned actions: wallet connection, local encrypted payment submission, local confidential wallet panel, and authenticated form submission.
- `LoginCard` uses one wallet-returned active account and disconnects by revoking this site's wallet permission so the user can switch accounts in the wallet before reconnecting.
- `checkout/CheckoutPaymentCard.tsx` is local-dev only: the buyer wallet submits encrypted payment directly, settlement credits encrypted pending buckets, and only the paid/rejected boolean becomes public.
- `merchant/MerchantBillingPanel.tsx` owns the configured-chain Growth wallet flow: read pass state, verify local cUSDT balance when applicable, submit one encrypted plan/amount charge request, then finalize/project chain evidence.
- `ui/` and `reui/` are generated registry infrastructure. They own appearance and accessibility defaults, never merchant payment state.
- `commerce/StatusBadge.tsx` and `commerce/StatusStepper.tsx` are the shared status and step-progress policies.
- `layout/TopBar.tsx` owns the compact account menu; it shows the current plan/avatar and sends logout through the Rust session boundary.
- `merchant/PaymentProjectConsole.tsx` is the project control plane: project secrets, webhook endpoints, delivery retries, checkout read model, merchant-signed withdraw action, and overview-owned settlement activity live there without CardForge-specific state.
