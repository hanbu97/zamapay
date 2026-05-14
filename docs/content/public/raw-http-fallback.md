---
title: "Raw HTTP Fallback"
description: "Use raw HTTP when your backend is not Node or when you want the smallest possible integration surface."
badge: "HTTP"
icon: "braces"
group: "Build"
order: 40
featured: false
---

## Bootstrap project context {% #raw-bootstrap %}

Raw HTTP remains the baseline protocol. The server SDK is a convenience wrapper around these endpoints, not a second API.

Always send Bearer project-secret auth and the preview version header from merchant backends.

```bash
curl -X GET \
  http://127.0.0.1:18080/api/project-secret/bootstrap \
  -H "authorization: Bearer zms_test_..." \
  -H "ZamaPay-Version: 2026-05-14"
```

The bootstrap response contains the project id, contract environment, current webhook endpoint id, endpoint URL, and current verifier secret when the backend is allowed to reveal it.

## Create ERC20 checkout {% #raw-evm-checkout %}

Ordinary EVM checkout creation returns a hosted checkout session plus an ERC20 settlement payment intent. The settlement contract event, not the merchant browser, is the payment truth.

```bash
curl -X POST \
  http://127.0.0.1:18080/api/projects/proj_123/checkout-sessions \
  -H "authorization: Bearer zms_test_..." \
  -H "ZamaPay-Version: 2026-05-14" \
  -H "idempotency-key: order_1001" \
  -H "content-type: application/json" \
  -d '{
    "merchantOrderId": "order_1001",
    "title": "Prepaid card bundle",
    "amountLabel": "120 USDT",
    "amountMinorUnits": 120000000,
    "note": "Release after ERC20 finality",
    "paymentRail": "evm_erc20",
    "evmChainId": 31337,
    "evmTokenSymbol": "USDT"
  }'
```

## Create private checkout {% #raw-private-checkout %}

Private checkout creation is separate. The merchant backend first prepares the Zama private chain invoice, then passes the resulting invoice id and chain transaction hash to ZamaPay.

```bash
curl -X POST \
  http://127.0.0.1:18080/api/projects/proj_123/checkout-sessions \
  -H "authorization: Bearer zms_test_..." \
  -H "ZamaPay-Version: 2026-05-14" \
  -H "idempotency-key: order_1002" \
  -H "content-type: application/json" \
  -d '{
    "merchantOrderId": "order_1002",
    "title": "Private prepaid card bundle",
    "amountLabel": "120 cUSDT",
    "amountMinorUnits": 120000000,
    "note": "Release after private payment finality",
    "paymentRail": "zama_private",
    "chainInvoiceId": 42,
    "chainTxHash": "0x..."
  }'
```
