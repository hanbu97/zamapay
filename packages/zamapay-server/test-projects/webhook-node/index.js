import assert from "node:assert/strict"
import { createServer, request } from "node:http"
import { constructWebhookEvent, generateTestHeaders } from "@zamapay/server/webhooks"

const secret = "whsec_aW5zdGFsbC1zaGFwZS1zZWNyZXQ"
const payload = '{"type":"checkout.paid","checkoutSessionId":"cs_webhook_node"}'
const headers = generateTestHeaders({
  messageId: "msg_webhook_node",
  payload,
  secret,
})

const server = createServer(async (req, res) => {
  const rawBody = await readBody(req)
  try {
    const event = constructWebhookEvent(rawBody, req.headers, { secret })
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ checkoutSessionId: event.checkoutSessionId, received: true }))
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }))
  }
})

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))

try {
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  const response = await sendWebhook(port)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), {
    checkoutSessionId: "cs_webhook_node",
    received: true,
  })
} finally {
  server.close()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sendWebhook(port) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(payload),
          "content-type": "application/json",
        },
        hostname: "127.0.0.1",
        method: "POST",
        path: "/webhook",
        port,
      },
      (res) => {
        const chunks = []
        res.on("data", (chunk) => chunks.push(chunk))
        res.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: res.statusCode,
          })
        })
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}
