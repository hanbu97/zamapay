import {
  BookOpenIcon,
  BoxesIcon,
  BracesIcon,
  ClipboardCheckIcon,
  KeyRoundIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  WebhookIcon,
} from "lucide-react"

export type DocsFigureKind = "project-console" | "api-handoff" | "webhook-outbox" | "cardforge"

export type DocsTable = {
  headers: string[]
  mergeFirstColumn?: boolean
  rows: string[][]
}

export type DocsStep = {
  title: string
  detail: string
}

export type DocsSection = {
  body: string[]
  code?: string
  figure?: DocsFigureKind
  id: string
  mermaid?: string
  steps?: DocsStep[]
  table?: DocsTable
  title: string
}

export type DocsPage = {
  badge: string
  description: string
  icon: typeof BookOpenIcon
  slug: string
  title: string
  sections: DocsSection[]
}

export const docsPages: DocsPage[] = [
  {
    badge: "Start here",
    description: "Create a payment project, issue a project API key, and hand CardForge a hosted checkout contract.",
    icon: BookOpenIcon,
    slug: "quickstart",
    title: "Quickstart",
    sections: [
      {
        body: [
          "Mermer Pay starts from a merchant payment project. The browser console creates the project and reveals one-time secrets; the merchant backend uses those secrets to create checkout sessions.",
          "The buyer-facing hosted checkout URL is returned only after Mermer Pay has assigned a non-null chain invoice id.",
        ],
        figure: "project-console",
        id: "project-first",
        steps: [
          {
            detail: "Open Docs from the public top bar, then log in and open the merchant console when you are ready to configure a real project.",
            title: "Open the docs and console",
          },
          {
            detail: "Create a project with `local-dev` for smoke tests or `sepolia` for browser wallet proof. Add the merchant backend webhook URL during creation when possible.",
            title: "Create a payment project",
          },
          {
            detail: "Generate a project API key and copy the one-time value into the merchant backend environment. Store the prefix for operations, not as an auth secret.",
            title: "Generate a project API key",
          },
          {
            detail: "Call the project checkout endpoint from the merchant backend. The merchant frontend must never call this endpoint with a dashboard cookie.",
            title: "Create hosted checkout sessions",
          },
        ],
        title: "The shortest correct path",
      },
      {
        body: [
          "Use these local services for the deterministic closed loop. The API URL points to Rust, the app URL points to Next.js, and CardForge stays in its own demo directory.",
        ],
        code: `# Terminal 1: Mermer Pay API
MERMER_API_BIND=127.0.0.1:8080 cargo run -p api

# Terminal 2: Mermer Pay web
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8080 npm run dev --workspace @mermer/web -- --port 3001

# Terminal 3: CardForge backend
cd demo/cardforge/backend
MERMER_PAY_PROJECT_ID=proj_...
MERMER_PAY_API_KEY=mmp_test_...
MERMER_PAY_WEBHOOK_SECRET=whsec_...
MERMER_PAY_API_URL=http://127.0.0.1:8080
cargo run`,
        id: "local-stack",
        title: "Local stack",
      },
    ],
  },
  {
    badge: "API",
    description: "Use project/API-key auth for external merchant checkout creation. Dashboard cookies are not part of this boundary.",
    icon: BracesIcon,
    slug: "api-reference",
    title: "API reference",
    sections: [
      {
        body: [
          "Project management endpoints are dashboard authenticated with the `mermer_session` cookie. Checkout creation is different: it is authenticated by a project API key and an idempotency key.",
          "This split is the core safety boundary. A leaked dashboard cookie should not be needed by merchant infrastructure, and a project API key should not control the dashboard.",
        ],
        figure: "api-handoff",
        id: "auth-model",
        table: {
          headers: ["Endpoint", "Auth", "Purpose"],
          rows: [
            ["POST /api/projects", "mermer_session cookie", "Create a merchant payment project."],
            ["POST /api/projects/{projectId}/api-keys", "mermer_session cookie", "Create a one-time project API key."],
            ["POST /api/projects/{projectId}/webhook-endpoints", "mermer_session cookie", "Register or rotate a webhook endpoint."],
            ["POST /api/projects/{projectId}/checkout-sessions", "Bearer project API key", "Create a buyer-payable hosted checkout session."],
            ["GET /api/projects/{projectId}/checkout-sessions/{checkoutSessionId}", "Bearer project API key", "Read one checkout session from merchant backend code."],
          ],
        },
        title: "Authentication boundaries",
      },
      {
        body: [
          "Send checkout creation from your merchant backend. The request must include `Authorization: Bearer <project API key>` and `idempotency-key`.",
        ],
        code: `curl -X POST \\
  http://127.0.0.1:8080/api/projects/proj_123/checkout-sessions \\
  -H "authorization: Bearer mmp_test_..." \\
  -H "idempotency-key: order_1001" \\
  -H "content-type: application/json" \\
  -d '{
    "merchantOrderId": "order_1001",
    "title": "Prepaid card bundle",
    "amountLabel": "120 cUSDT",
    "amountMinorUnits": 120000000,
    "note": "Release after finality-safe payment",
    "successUrl": "http://127.0.0.1:8093/success",
    "cancelUrl": "http://127.0.0.1:8093/cancel",
    "metadata": { "source": "cardforge" }
  }'`,
        id: "create-checkout",
        title: "Create a checkout session",
      },
    ],
  },
  {
    badge: "Delivery",
    description: "Receive signed payment events, return 2xx only after durable acceptance, and use delivery ids for idempotency.",
    icon: WebhookIcon,
    slug: "webhooks",
    title: "Webhooks",
    sections: [
      {
        body: [
          "Mermer Pay emits project-level webhook events after the payment read model and finality gate agree. Each delivery records attempt count, HTTP status, response body, error, retry state, and dead-letter state.",
          "Webhook payloads are at-least-once. The merchant backend must use `x-mermer-webhook-id` or the event id as an idempotency key.",
        ],
        figure: "webhook-outbox",
        id: "delivery-model",
        table: {
          headers: ["Header", "Example", "Use"],
          rows: [
            ["x-mermer-webhook-id", "deliv_...", "Delivery id for idempotent processing."],
            ["x-mermer-event-id", "evt_...", "Immutable event id."],
            ["x-mermer-webhook-timestamp", "2026-05-07T05:00:00Z", "Signed timestamp."],
            ["x-mermer-webhook-signature", "v1=0x...", "Payload authenticity proof."],
            ["x-mermer-webhook-algorithm", "keccak256.secret_prefix.v1", "Signature algorithm version."],
          ],
        },
        title: "Delivery model",
      },
      {
        body: [
          "Verification canonicalizes the JSON body, builds `deliveryId.timestamp.canonicalBody`, and checks the keyed digest with the webhook secret. Reject missing headers before reading business fields.",
        ],
        code: `import { keccak256, toUtf8Bytes } from "ethers"

export function verifyMermerWebhook(headers, body, secret) {
  const deliveryId = headers["x-mermer-webhook-id"]
  const timestamp = headers["x-mermer-webhook-timestamp"]
  const signature = headers["x-mermer-webhook-signature"]
  const algorithm = headers["x-mermer-webhook-algorithm"]

  if (algorithm !== "keccak256.secret_prefix.v1") throw new Error("unsupported algorithm")

  const canonicalBody = JSON.stringify(body)
  const base = \`\${deliveryId}.\${timestamp}.\${canonicalBody}\`
  const expected = "v1=" + keccak256(toUtf8Bytes(\`\${secret}.\${base}\`))
  if (signature !== expected) throw new Error("invalid signature")

  return body
}`,
        id: "verify-signature",
        title: "Verify a webhook",
      },
    ],
  },
  {
    badge: "Demo",
    description: "Run CardForge as a separate merchant template that consumes Mermer Pay configuration.",
    icon: BoxesIcon,
    slug: "cardforge",
    title: "CardForge integration",
    sections: [
      {
        body: [
          "CardForge is not part of the Mermer Pay platform app. It is a standalone merchant template under `demo/cardforge` and receives only project configuration.",
          "The browser talks to CardForge. CardForge talks to Mermer Pay with its project API key. Browser cookies from Mermer Pay must not be forwarded.",
        ],
        figure: "cardforge",
        id: "standalone-boundary",
        table: {
          headers: ["Variable", "Required", "Meaning"],
          rows: [
            ["MERMER_PAY_PROJECT_ID", "yes", "Project id from the merchant console."],
            ["MERMER_PAY_API_KEY", "yes", "One-time revealed project API key."],
            ["MERMER_PAY_WEBHOOK_SECRET", "yes", "Secret used to verify Mermer webhook signatures."],
            ["MERMER_PAY_API_URL", "yes", "Rust API base URL, for example http://127.0.0.1:8080."],
            ["CARDFORGE_WEBHOOK_ENDPOINT", "optional", "Defaults to http://127.0.0.1:8092/api/mermer-pay/webhook."],
          ],
        },
        title: "Standalone boundary",
      },
      {
        body: [
          "Use the built-in deterministic verifier when you need proof that project creation, key creation, CardForge checkout, hosted checkout, payment projection, signed webhook, and dashboard stats agree.",
        ],
        code: `npm run verify:merchant-loop`,
        id: "closed-loop-proof",
        title: "Closed loop proof",
      },
    ],
  },
  {
    badge: "Privacy",
    description:
      "Prove the hackathon private-checkout moment: encrypted amount validation plus a private fulfillment trigger.",
    icon: ShieldCheckIcon,
    slug: "private-checkout-v1",
    title: "Private Checkout v1",
    sections: [
      {
        body: [
          "Private Checkout v1 is a Private Checkout Proof MVP. It proves that a checkout contract can validate encrypted amount equality and emit only a fulfillment-safe paid/rejected result.",
          "The privacy claim is scoped to PrivateCheckoutSettlement storage and events. Public observers should not see buyer wallet, merchant wallet, payout wallet, project id, order id, or amount there. Token funding, wrapping, gas, or a future transfer rail must be reviewed separately.",
        ],
        id: "privacy-target",
        table: {
          headers: ["Data", "Chain treatment", "Who knows in v1"],
          rows: [
            [
              "Buyer wallet",
              "Not submitted to PrivateCheckoutSettlement as msg.sender; relayer submits",
              "Buyer and Mermer Pay if product flow identifies them",
            ],
            ["Merchant / payout wallet", "Not stored or emitted by the settlement contract", "Mermer Pay and merchant backend"],
            ["Project / order id", "Hashed into orderCommitment", "Mermer Pay and merchant backend"],
            ["Gross and paid amount", "FHE encrypted handles", "Mermer Pay in v1, hidden from public chain observers"],
            ["Paid/rejected", "Public boolean after decrypting accepted", "Everyone"],
          ],
        },
        title: "Privacy target",
      },
      {
        body: [
          "The design has two layers. The first is required for the hackathon proof. The second must be explicitly named so the demo does not confuse encrypted equality with real asset settlement.",
        ],
        id: "mvp-layers",
        table: {
          headers: ["Layer", "What it proves", "v1 position"],
          rows: [
            [
              "Private Checkout Proof",
              "expectedAmount and paidAmount stay encrypted; the contract checks FHE.eq and reveals only accepted.",
              "Required in the hackathon demo.",
            ],
            [
              "Payment Rail",
              "The buyer actually paid, or the demo honestly simulated settlement before relaying.",
              "Declare as demo balance, mock confidential cUSDT, or real confidential transfer.",
            ],
            [
              "Merchant Settlement / Withdraw",
              "Merchant net, platform fee, and payout close without per-order public disclosure.",
              "Out of v1; keep as a future settlement hook.",
            ],
          ],
        },
        title: "MVP boundary",
      },
      {
        body: [
          "Use this field contract as the implementation boundary. Core checkout values may exist on-chain only as FHE handles. Public fields must be commitments, coarse status, or time bounds. Raw business and wallet data stays out of public settlement storage, events, and calldata.",
        ],
        id: "field-contract",
        table: {
          headers: ["Boundary", "Field", "Type", "Meaning", "Public rule"],
          mergeFirstColumn: true,
          rows: [
            [
              "On-chain encrypted, v1 core",
              "expectedAmount",
              "euint64",
              "Order amount due.",
              "Stored only as an FHE handle; never emitted as plaintext.",
            ],
            [
              "On-chain encrypted, v1 core",
              "paidAmount",
              "externalEuint64",
              "Buyer-submitted payment amount.",
              "Submitted with inputProof and imported through FHE.fromExternal.",
            ],
            [
              "On-chain encrypted, v1 core",
              "paymentCheck",
              "ebool",
              "Encrypted result of paidAmount == expectedAmount.",
              "Only this boolean is publicly decrypted as accepted.",
            ],
            [
              "On-chain encrypted, future settlement hook",
              "encryptedMerchantPending[settlementBucketCommitment]",
              "euint64",
              "Merchant aggregate settlement balance.",
              "Keep outside the per-checkout struct; decrypt only during batch settlement or withdraw.",
            ],
            [
              "On-chain encrypted, future settlement hook",
              "encryptedPlatformPending",
              "euint64",
              "Platform aggregate fee balance.",
              "Fee balance stays encrypted until batch settlement or withdraw.",
            ],
            [
              "On-chain public",
              "orderCommitment",
              "bytes32",
              "hash(orderId, projectId, amount, salt).",
              "Stable order reference only; raw ids and amount stay off-chain.",
            ],
            [
              "On-chain public",
              "settlementBucketCommitment",
              "bytes32",
              "hash(merchantId, settlementEpoch, randomSalt), not merchant address.",
              "Rotate by checkout, batch, day, or week; never use a permanent merchant id.",
            ],
            [
              "On-chain public",
              "paymentStatus",
              "enum",
              "created / submitted / accepted / rejected / expired.",
              "Coarse fulfillment state; no counterparty or amount data.",
            ],
            [
              "On-chain public",
              "expiresAt",
              "uint64",
              "Checkout deadline.",
              "Public time bound used to reject stale payment attempts.",
            ],
            [
              "On-chain public",
              "paidAt",
              "uint256",
              "Finalization timestamp.",
              "Time signal only; do not pair it with raw order or wallet fields.",
            ],
            [
              "On-chain public",
              "relayer address",
              "address",
              "Transaction sender, not buyer.",
              "Public because of EVM mechanics; relayer address must not identify buyer.",
            ],
            [
              "Never public on-chain",
              "buyer address",
              "address",
              "Actual buyer wallet.",
              "Do not use as msg.sender, calldata, storage, or event data.",
            ],
            [
              "Never public on-chain",
              "merchant address",
              "address",
              "Merchant wallet or dashboard identity.",
              "Keep in Mermer Pay and merchant backend only.",
            ],
            [
              "Never public on-chain",
              "payout wallet",
              "address",
              "Settlement destination.",
              "Keep off-chain until a later private withdraw design exists.",
            ],
            [
              "Never public on-chain",
              "amountDue plaintext",
              "uint64 / token minor units",
              "Plain order amount.",
              "Use encrypted expectedAmount or an order commitment instead.",
            ],
            [
              "Never public on-chain",
              "merchantNet plaintext",
              "uint64 / token minor units",
              "Plain merchant net split.",
              "Use future encrypted settlement accumulators and batch or merchant-only decrypt later.",
            ],
            [
              "Never public on-chain",
              "platformFee plaintext",
              "uint64 / token minor units",
              "Plain platform fee split.",
              "Use future encrypted settlement accumulators and batch decrypt later.",
            ],
            [
              "Never public on-chain",
              "projectId plaintext",
              "string / bytes",
              "Mermer Pay project id.",
              "Hash into orderCommitment; never store the raw business id.",
            ],
            [
              "Never public on-chain",
              "orderId plaintext",
              "string / bytes",
              "Merchant order id.",
              "Hash into orderCommitment; never store the raw order id.",
            ],
          ],
        },
        title: "Field contract",
      },
      {
        body: [
          "Encrypted equality proves that an encrypted paidAmount equals the encrypted expectedAmount. It does not prove that value moved. The selected rail must be part of the demo contract, backend policy, or test script.",
        ],
        id: "payment-rail",
        table: {
          headers: ["Rail", "What it proves", "Use in hackathon"],
          rows: [
            ["Mermer Pay demo balance", "Backend checked or debited an off-chain demo balance before relaying.", "Fastest path; label it mock settlement."],
            [
              "Mock cUSDT confidential balance",
              "Buyer has a demo confidential balance and payment submission records or deducts an encrypted debit.",
              "Recommended hard MVP if time allows.",
            ],
            [
              "ERC-7984 / confidential wrapper transfer",
              "A confidential token balance or transfer amount moves through a token contract.",
              "Post-MVP unless address linkage and operator semantics are deliberately handled.",
            ],
          ],
        },
        title: "Payment rail",
      },
      {
        body: [
          "Use on-chain encryption when the contract must compute over a value. Use commitments when the chain only needs a stable reference and should not learn the raw identity or business id.",
          "In this design, amounts are encrypted because the settlement contract compares paidAmount with expectedAmount. Buyer, merchant, payout wallet, project id, and order id stay out of PrivateCheckoutSettlement storage and events.",
        ],
        id: "encrypted-vs-hidden",
        table: {
          headers: ["Concept", "Use it for", "Rule"],
          rows: [
            ["On-chain encrypted", "expectedAmount, paidAmount, paymentCheck", "Chain can compute, observers cannot read"],
            ["Not public on-chain", "buyer, merchant, payout wallet, projectId, orderId", "Raw value never appears in storage, events, or calldata"],
            ["Commitment", "orderCommitment, settlementBucketCommitment", "Hash high-entropy salted business data; rotate settlement buckets"],
          ],
        },
        title: "Encrypted vs hidden",
      },
      {
        body: [
          "The normal checkout path decrypts only accepted, an ebool. Per-order gross, merchant net, and platform fee stay encrypted and can be handled by settlement batches later.",
          "Expected and paid amounts are encrypted as external inputs with input proofs, then imported by the contract. Mermer Pay verifies the selected payment rail before relaying the encrypted paidAmount.",
        ],
        code: `accepted = FHE.eq(paidAmount, expectedAmount)`,
        id: "payment-flow",
        mermaid: `flowchart TD
  A["CardForge creates order"] --> B["Mermer Pay derives orderCommitment"]
  B --> C["Rotate settlementBucketCommitment"]
  C --> D["Encrypt expectedAmount + inputProof"]
  D --> E["createPrivateCheckout"]
  E --> F["Buyer encrypts paidAmount + signs intent"]
  F --> G["Verify intent and payment rail"]
  G --> H["Relayer submitPrivatePayment"]
  H --> I["FHE.fromExternal + FHE.eq"]
  I --> J["Public decrypt only accepted ebool"]
  J --> K["PrivatePaymentFinalized(orderCommitment, accepted)"]
  K --> L{"accepted?"}
  L -- true --> M["Send CardForge fulfillment webhook"]
  L -- false --> N["Mark rejected"]
  M --> O["CardForge releases card"]`,
        title: "Payment flow",
      },
      {
        body: [
          "The checkout record should stay small. Settlement accounting belongs outside the per-checkout struct, and only after the proof path works.",
        ],
        code: `enum PaymentStatus {
    None,
    Created,
    Submitted,
    Accepted,
    Rejected,
    Expired
}

struct PrivateCheckout {
    bytes32 orderCommitment;
    bytes32 settlementBucketCommitment;
    euint64 expectedAmount;
    ebool paymentCheck;
    PaymentStatus status;
    uint64 expiresAt;
    uint256 paidAt;
}`,
        id: "contract-shape",
        title: "Contract shape",
      },
      {
        body: [
          "Payment intent and lifecycle controls are part of the MVP, because they stop the demo from becoming a free-card oracle.",
        ],
        id: "safety-controls",
        table: {
          headers: ["Control", "Rule", "Failure blocked"],
          rows: [
            [
              "Payment intent binding",
              "Bind orderCommitment, encrypted amount handle, asset, chainId, settlement contract, nonce, and expiresAt.",
              "Relayer replaying one valid encrypted amount against another checkout.",
            ],
            ["Expiry", "Reject payment submission after expiresAt.", "Late payment after merchant order is stale."],
            ["Nonce reuse", "Reject reused payment nonce or already-submitted intent.", "Duplicate payment attempts and replay."],
            ["Final status lock", "Accepted, rejected, and expired checkouts cannot be submitted or finalized again.", "Double fulfillment."],
            ["Rotating bucket", "settlementBucketCommitment rotates by checkout, batch, day, or week.", "Long-lived merchant activity graph."],
          ],
        },
        title: "Safety controls",
      },
      {
        body: [
          "The demo contract should be new, not a small patch over the current transparent settlement contract. The current contract exposes merchant, payoutWallet, payer, and amountDue by design.",
          "Private Checkout v1 succeeds when PrivateCheckoutSettlement events expose only commitments, encrypted handles, status, and timestamps, while CardForge still receives a fulfillment-ready webhook.",
        ],
        id: "acceptance",
        steps: [
          {
            detail: "Create one private checkout on local-dev from a CardForge order and store only commitments plus encrypted expectedAmount on-chain.",
            title: "Create private checkout",
          },
          {
            detail: "Submit payment through the Mermer Pay relayer so public tx sender is not the buyer wallet.",
            title: "Relay buyer payment",
          },
          {
            detail: "Verify the selected payment rail, then use FHE equality to compare encrypted paidAmount with encrypted expectedAmount.",
            title: "Validate privately",
          },
          {
            detail: "Decrypt only accepted, map orderCommitment back to the demo order, and release the card through the existing webhook path.",
            title: "Finalize fulfillment",
          },
          {
            detail: "Prove replay, expired payment, resubmit-after-final, and double-finalize paths are rejected.",
            title: "Block payment abuse",
          },
        ],
        title: "Acceptance criteria",
      },
    ],
  },
  {
    badge: "Ops",
    description: "Know which environment you are testing and which checks prove the rail is ready.",
    icon: ShieldCheckIcon,
    slug: "environments",
    title: "Environments",
    sections: [
      {
        body: [
          "`local-dev` is deterministic and should pass before any public wallet run. `sepolia` adds real RPC, deployed contracts, faucet balances, and browser wallet requirements.",
          "Keep environment explicit in projects, API keys, checkout sessions, webhook endpoints, events, and delivery records.",
        ],
        id: "environment-policy",
        table: {
          headers: ["Environment", "Use", "Required proof"],
          rows: [
            ["local-dev", "Fast product loop and CI smoke.", "npm run verify:merchant-loop"],
            ["sepolia", "Browser wallet and public testnet demo.", "npm run verify:sepolia plus wallet payment proof."],
            ["production", "Not enabled in this hackathon build.", "Real merchant signer custody, public HTTPS webhook, monitoring, and rate limits."],
          ],
        },
        title: "Environment policy",
      },
      {
        body: [
          "A Sepolia browser proof requires an injected EIP-1193 wallet. Funding and contract manifests can be ready while the in-app browser remains blocked because it has no wallet provider.",
        ],
        code: `npm run verify:sepolia`,
        id: "sepolia-readiness",
        title: "Sepolia readiness",
      },
    ],
  },
]

export const docsBySlug = new Map(docsPages.map((page) => [page.slug, page]))

export const featuredDocs = docsPages.slice(0, 4)

export const docsChecklist = [
  {
    icon: ReceiptTextIcon,
    title: "Project first",
    value: "Every merchant integration starts with a payment project.",
  },
  {
    icon: KeyRoundIcon,
    title: "API key boundary",
    value: "Merchant backends create checkouts with project API keys, not session cookies.",
  },
  {
    icon: WebhookIcon,
    title: "Signed release",
    value: "Fulfillment listens to signed project webhook deliveries.",
  },
  {
    icon: ClipboardCheckIcon,
    title: "Local proof",
    value: "The deterministic loop must pass before Sepolia browser demos.",
  },
]
