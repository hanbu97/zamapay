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

export const docsDemoUrl = "https://demo.zamapay.org"

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
          "ZamaPay starts from a merchant payment project. The browser console creates the project and reveals one-time secrets; the merchant backend uses those secrets to create checkout sessions.",
          "The buyer-facing hosted checkout URL is returned only after ZamaPay has assigned a non-null chain invoice id.",
        ],
        figure: "project-console",
        id: "project-first",
        steps: [
          {
            detail: "Open Docs from the public top bar, then log in and open the merchant console when you are ready to configure a real project.",
            title: "Open the docs and console",
          },
          {
            detail: "Create a project with `local-dev`. Add the merchant backend webhook URL during creation when possible.",
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
          "Use these local services for the deterministic closed loop. After every Hardhat Local reset, run the root reset command once so the ZamaPay and CardForge databases match the fresh chain.",
          "Environment files live under `env/`: commit only `*.env.example`, keep same-name `.env` files local, and use `just` recipes to compose them.",
        ],
        code: `# Terminal 0
just db-up
just contracts-node

# Terminal 1
just reset-local
just api-local

# Terminal 2
just web-local

# Terminal 3
just cardforge-api-local

# Terminal 4
just cardforge-web-local`,
        id: "local-stack",
        title: "Local stack",
      },
      {
        body: [
          "Supabase changes the Postgres host, not the local-dev chain. The `just` recipes source local-dev first and the Supabase override second so only the database URL is replaced.",
        ],
        code: `# ZamaPay API with Supabase Postgres
just api-supabase-local

# CardForge backend with Supabase Postgres
just cardforge-api-supabase-local`,
        id: "supabase-overrides",
        title: "Supabase overrides",
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
          "Project management endpoints are dashboard authenticated with the `zamapay_session` cookie. Checkout creation is different: it is authenticated by a project API key and an idempotency key.",
          "This split is the core safety boundary. A leaked dashboard cookie should not be needed by merchant infrastructure, and a project API key should not control the dashboard.",
        ],
        figure: "api-handoff",
        id: "auth-model",
        table: {
          headers: ["Endpoint", "Auth", "Purpose"],
          rows: [
            ["POST /api/projects", "zamapay_session cookie", "Create a merchant payment project."],
            ["POST /api/projects/{projectId}/api-keys", "zamapay_session cookie", "Create a one-time project API key."],
            ["POST /api/projects/{projectId}/webhook-endpoints", "zamapay_session cookie", "Register or rotate a webhook endpoint."],
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
  -H "authorization: Bearer zmp_test_..." \\
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
          "ZamaPay emits project-level webhook events after the payment read model and finality gate agree. Each delivery records attempt count, HTTP status, response body, error, retry state, and dead-letter state.",
          "Webhook payloads are at-least-once. The merchant backend must use `x-zamapay-webhook-id` or the event id as an idempotency key.",
        ],
        figure: "webhook-outbox",
        id: "delivery-model",
        table: {
          headers: ["Header", "Example", "Use"],
          rows: [
            ["x-zamapay-webhook-id", "deliv_...", "Delivery id for idempotent processing."],
            ["x-zamapay-event-id", "evt_...", "Immutable event id."],
            ["x-zamapay-webhook-timestamp", "2026-05-07T05:00:00Z", "Signed timestamp."],
            ["x-zamapay-webhook-signature", "v1=0x...", "Payload authenticity proof."],
            ["x-zamapay-webhook-algorithm", "keccak256.secret_prefix.v1", "Signature algorithm version."],
          ],
        },
        title: "Delivery model",
      },
      {
        body: [
          "Verification canonicalizes the JSON body, builds `deliveryId.timestamp.canonicalBody`, and checks the keyed digest with the webhook secret. Reject missing headers before reading business fields.",
        ],
        code: `import { keccak256, toUtf8Bytes } from "ethers"

export function verifyZamaPayWebhook(headers, body, secret) {
  const deliveryId = headers["x-zamapay-webhook-id"]
  const timestamp = headers["x-zamapay-webhook-timestamp"]
  const signature = headers["x-zamapay-webhook-signature"]
  const algorithm = headers["x-zamapay-webhook-algorithm"]

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
    description: "Run CardForge as a separate merchant template that consumes ZamaPay configuration.",
    icon: BoxesIcon,
    slug: "cardforge",
    title: "CardForge integration",
    sections: [
      {
        body: [
          "CardForge is not part of the ZamaPay platform app. It is a standalone merchant template under `demo/cardforge` and receives only project configuration.",
          "The browser talks to CardForge. CardForge talks to ZamaPay with its project API key. Browser cookies from ZamaPay must not be forwarded.",
        ],
        figure: "cardforge",
        id: "standalone-boundary",
        table: {
          headers: ["Variable", "Required", "Meaning"],
          rows: [
            ["ZAMAPAY_PROJECT_ID", "yes", "Project id from the merchant console."],
            ["ZAMAPAY_API_KEY", "yes", "One-time revealed project API key."],
            ["ZAMAPAY_WEBHOOK_SECRET", "yes", "Secret used to verify ZamaPay webhook signatures."],
            ["ZAMAPAY_API_URL", "yes", "Rust API base URL, for example http://127.0.0.1:8080."],
            ["ZAMAPAY_CHAIN_INVOICE_API_URL", "yes", "ZamaPay web URL used by the backend to create local-dev private chain invoices."],
            ["CARDFORGE_DATABASE_URL", "yes", "Independent CardForge Postgres database URL."],
            ["CARDFORGE_STORE_KEY", "optional", "Local namespace inside the CardForge database; defaults to local-dev."],
            ["CARDFORGE_WEBHOOK_ENDPOINT", "optional", "Defaults to http://127.0.0.1:8092/api/zamapay/webhook."],
            ["NEXT_PUBLIC_CARDFORGE_API_URL", "frontend only", "Browser-safe CardForge backend URL."],
            ["NEXT_PUBLIC_ZAMAPAY_CONSOLE_URL", "frontend only", "Browser-safe link back to the ZamaPay merchant console."],
          ],
        },
        title: "Standalone boundary",
      },
      {
        body: [
          "CardForge has two process boundaries. The backend receives secrets from `env/local-dev.cardforge-backend.env`; the frontend receives only browser-safe `NEXT_PUBLIC_*` values from `env/local-dev.cardforge-frontend.env`. Use the recipes instead of hand-sourcing the files.",
        ],
        code: `just cardforge-api-local
just cardforge-web-local

# Hosted Postgres override for the backend:
just cardforge-api-supabase-local`,
        id: "cardforge-env-files",
        title: "CardForge env files",
      },
      {
        body: [
          "Use the local readiness gate for service truth, then run the browser CardForge flow for the private checkout proof. The old direct payment-projection script is intentionally removed.",
        ],
        code: `just verify-local`,
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
          "The implemented local-dev token is ConfidentialUSDMock: an official-style mintable confidential cUSDT mock keyed by wallet address. It is not a MetaMask ERC20 token and should not be tested through a public ERC20 transfer.",
          "The privacy claim is scoped to checkout business data in PrivateCheckoutSettlement storage and events. Public observers should not see merchant wallet, payout wallet, project id, order id, or amount there. In the direct-wallet MVP, the paying wallet is still visible as the EVM transaction sender, and withdraw recipient privacy is not claimed.",
        ],
        id: "privacy-target",
        table: {
          headers: ["Data", "Chain treatment", "Who knows in v1"],
          rows: [
            [
              "Buyer wallet",
              "Direct-wallet MVP submits as msg.sender; not stored as an order field",
              "Public chain observers can see tx sender; ZamaPay can map the checkout",
            ],
            ["Merchant wallet", "Checkout uses settlementBucketCommitment and bucketOwnerCommitment", "ZamaPay, merchant backend, and withdraw observers"],
            ["Payout wallet", "Not stored or emitted during checkout/payment; v1 withdraw recipient is calldata", "Merchant backend and withdraw observers"],
            ["Project / order id", "Hashed into orderCommitment", "ZamaPay and merchant backend"],
            ["Gross and paid amount", "FHE encrypted handles", "ZamaPay in v1, hidden from public chain observers"],
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
              "The buyer actually paid, or the demo honestly simulated settlement before finalization.",
              "Implemented as mock confidential cUSDT balance on local-dev.",
            ],
            [
              "Merchant Settlement / Withdraw",
              "Merchant net, platform fee, and payout close without per-order public disclosure.",
              "Implemented for local-dev; payout-recipient privacy is not claimed in v1.",
            ],
          ],
        },
        title: "MVP boundary",
      },
      {
        body: [
          "Use this field contract as the implementation boundary. Core checkout values may exist on-chain only as FHE handles. Public checkout fields must be commitments, coarse status, or time bounds. The direct-wallet payer is public as the transaction sender, and v1 withdraw reveals the authorized recipient in calldata.",
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
              "merchantNetAmount",
              "euint64",
              "Merchant net split for this checkout.",
              "Imported with the same input proof; only added to encrypted pending if payment succeeds.",
            ],
            [
              "On-chain encrypted, v1 core",
              "platformFeeAmount",
              "euint64",
              "Platform fee split for this checkout.",
              "Imported with the same input proof; only added to encrypted pending if payment succeeds.",
            ],
            [
              "On-chain encrypted, v1 core",
              "splitCheck",
              "ebool",
              "Encrypted result of merchantNetAmount + platformFeeAmount == expectedAmount.",
              "Never decrypted per order; gates payment acceptance.",
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
              "On-chain encrypted, v1 settlement",
              "encryptedMerchantPending[settlementBucketCommitment]",
              "euint64",
              "Merchant aggregate settlement balance.",
              "Accrued only by accepted checkouts; moved by merchant-authorized encrypted withdraw.",
            ],
            [
              "On-chain encrypted, v1 settlement",
              "encryptedPlatformPending",
              "euint64",
              "Platform aggregate fee balance.",
              "Fee balance stays encrypted until platform settlement is explicitly added.",
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
              "bucketOwnerCommitment",
              "bytes32",
              "hash(settlementBucketCommitment, bucketOwner).",
              "Submitted during checkout creation instead of the raw merchant wallet.",
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
              "buyer tx sender",
              "address",
              "Wallet that submits submitPrivatePayment in the direct MVP.",
              "Public because of EVM mechanics; do not claim payer-address privacy in this MVP.",
            ],
            [
              "Never public in checkout calldata/events",
              "merchant address",
              "address",
              "Merchant wallet or dashboard identity.",
              "Checkout events do not emit it; withdraw authorization may reveal it.",
            ],
            [
              "Withdraw calldata",
              "payout wallet during withdraw",
              "address",
              "Settlement destination.",
              "Bound by merchant EIP-712 authorization; local-dev does not claim payout-recipient privacy.",
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
              "Use encrypted settlement accumulators and merchant-only dashboard projection.",
            ],
            [
              "Never public on-chain",
              "platformFee plaintext",
              "uint64 / token minor units",
              "Plain platform fee split.",
              "Use encrypted settlement accumulators and platform-only projection.",
            ],
            [
              "Never public on-chain",
              "projectId plaintext",
              "string / bytes",
              "ZamaPay project id.",
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
            [
              "Direct mock cUSDT confidential balance",
              "Buyer has a demo confidential balance and the buyer-submitted transaction deducts an encrypted amount.",
              "Implemented local-dev path.",
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
          "In this design, amounts are encrypted because the settlement contract compares paidAmount with expectedAmount. Merchant, payout wallet, project id, and order id stay out of checkout/payment storage and events. Payer-address privacy is not claimed while the buyer submits the EVM transaction directly; payout-recipient privacy is not claimed for v1 withdraw.",
        ],
        id: "encrypted-vs-hidden",
        table: {
          headers: ["Concept", "Use it for", "Rule"],
          rows: [
            ["On-chain encrypted", "expectedAmount, paidAmount, paymentCheck", "Chain can compute, observers cannot read"],
            ["Not public in checkout/payment", "merchant, payout wallet, projectId, orderId", "Raw value never appears in checkout creation, payment submission, payment storage, or payment events"],
            ["Commitment", "orderCommitment, settlementBucketCommitment", "Hash high-entropy salted business data; rotate settlement buckets"],
          ],
        },
        title: "Encrypted vs hidden",
      },
      {
        body: [
          "The normal checkout path decrypts only accepted, an ebool. Per-order gross, merchant net, and platform fee stay encrypted and can be handled by settlement batches later.",
          "Expected and paid amounts are encrypted as external inputs with input proofs, then imported by the contract. Local-dev uses Hardhat/FHEVM mock RPC; Sepolia uses Zama's official test relayer through `@zama-fhe/relayer-sdk` `SepoliaConfig`.",
        ],
        code: `accepted = FHE.eq(paidAmount, expectedAmount)`,
        id: "payment-flow",
        mermaid: `flowchart TD
  A["CardForge creates order"] --> B["ZamaPay derives orderCommitment"]
  B --> C["Rotate settlementBucketCommitment"]
  C --> D["Encrypt expectedAmount + inputProof"]
  D --> E["createPrivateCheckout"]
  E --> F["Buyer connects wallet"]
  F --> G["Browser encrypts paidAmount + inputProof"]
  G --> H["Buyer wallet submits submitPrivatePayment"]
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
          "The checkout record stays small. It keeps encrypted gross/net/fee handles for validation, while aggregate pending balances live in bucket mappings outside each checkout.",
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
    euint64 merchantNetAmount;
    euint64 platformFeeAmount;
    ebool splitCheck;
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
              "Bind orderCommitment, encrypted amount handle, asset, chainId, settlement contract, nonce, and expiresAt before adding any future sponsored submitter mode.",
              "Replaying one valid encrypted amount against another checkout.",
            ],
            [
              "Withdraw authorization",
              "Merchant signs settlementBucketCommitment, withdrawalNonce, bucketOwner, recipient, encryptedAmount handle, inputProofHash, deadline, chainId, and settlement contract.",
              "A chain submitter moving an unauthorized bucket or swapping the encrypted withdraw input.",
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
          "The demo contract should stay separate from the old transparent settlement shape. Transparent settlement exposed merchant, payoutWallet, payer, and amountDue by design.",
          "Private Checkout v1 succeeds when PrivateCheckoutSettlement events expose only commitments, encrypted handles, status, and timestamps, while CardForge still receives a fulfillment-ready webhook.",
        ],
        id: "acceptance",
        steps: [
          {
            detail: "Create one private checkout on the active contract environment from a CardForge order and store only commitments plus encrypted expectedAmount on-chain.",
            title: "Create private checkout",
          },
          {
            detail: "Submit encrypted payment directly from the buyer wallet. Local-dev uses mock RPC for proofs; Sepolia uses Zama official test relayer proofs.",
            title: "Submit buyer payment",
          },
          {
            detail: "Verify the ConfidentialUSDMock debit, then use FHE equality to compare encrypted paidAmount with encrypted expectedAmount.",
            title: "Validate privately",
          },
          {
            detail: "Decrypt only accepted, map orderCommitment back to the demo order, and release the card through the existing webhook path.",
            title: "Finalize fulfillment",
          },
          {
            detail: "Merchant signs an EIP-712 withdraw authorization; the local chain submitter sends the encrypted withdraw transaction and the read model records the chain hash.",
            title: "Withdraw aggregate balance",
          },
          {
            detail: "Prove replay, expired payment, resubmit-after-final, double-finalize, and unauthorized withdraw paths are rejected.",
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
          "`local-dev` is the fast mock-encryption product loop. `sepolia` is the public-testnet target that uses the real Zama FHEVM stack and deployed manifests.",
          "Keep environment explicit in projects, API keys, checkout sessions, webhook endpoints, events, and delivery records so the same read model can move from local-dev to Sepolia without hidden defaults.",
        ],
        id: "environment-policy",
        table: {
          headers: ["Environment", "Use", "Required proof"],
          rows: [
            ["local-dev", "Fast product loop and CI smoke.", "`just verify-local`"],
            ["sepolia", "Public demo with real FHEVM encryption.", "`just deploy-sepolia-contracts`, then `just api-sepolia-local-ui` and `just web-sepolia-local-ui`."],
            ["production", "Not enabled in this hackathon build.", "Real merchant signer custody, public HTTPS webhook, monitoring, and rate limits."],
          ],
        },
        title: "Environment policy",
      },
      {
        body: [
          "Local-dev must stay clean: private checkout uses `PrivateCheckoutSettlement`, mock cUSDT uses `ConfidentialUSDMock`, and there is no transparent invoice fallback.",
          "Use `env/local-dev.*.env` for Docker Postgres. Use `env/supabase.*.env` only as a database override while the chain remains local-dev.",
        ],
        code: `just reset-local
just verify-local`,
        id: "local-readiness",
        title: "Local readiness",
      },
      {
        body: [
          "Sepolia deployment reads `env/sepolia.contracts.env`, writes `generated/contracts/addresses/sepolia.json`, and regenerates the TypeScript/Rust contract clients.",
          "Local dashboards and CardForge can still run on `127.0.0.1`; chain/RPC/manifest move to Sepolia, and browser FHE operations use Zama's official test relayer via `SepoliaConfig`.",
        ],
        code: `just deploy-sepolia-contracts
just api-sepolia-local-ui
just web-sepolia-local-ui`,
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
    value: "The deterministic loop must pass before any public-testnet browser demo.",
  },
]
