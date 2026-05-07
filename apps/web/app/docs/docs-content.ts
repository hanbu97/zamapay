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
  headers: [string, string, string]
  rows: [string, string, string][]
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
