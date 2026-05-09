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

- Client components are reserved for browser-owned actions: wallet signing, local payment intent, local confidential wallet panel, and authenticated form submission.
- `LoginCard` uses one wallet-returned active account and disconnects by revoking this site's wallet permission so the user can switch accounts in the wallet before reconnecting.
- `checkout/CheckoutPaymentCard.tsx` is local-dev only: the buyer signs a private checkout intent, the Mermer Pay relayer submits encrypted payment, and only the paid/rejected boolean becomes public.
- `merchant/MerchantBillingPanel.tsx` owns local-dev Growth upgrade projection and reads the subscription pass state; it no longer contains public-testnet browser-relayer payment code.
- `ui/` and `reui/` are generated registry infrastructure. They own appearance and accessibility defaults, never merchant payment state.
- `commerce/StatusBadge.tsx` and `commerce/StatusStepper.tsx` are the shared status and step-progress policies.
- `layout/TopBar.tsx` owns the compact account menu; it shows the current plan/avatar and sends logout through the Rust session boundary.
- `merchant/PaymentProjectConsole.tsx` is the project control plane: API keys, webhook endpoints, delivery retries, checkout read model, withdraw records, and diagnostics live there without CardForge-specific state.
