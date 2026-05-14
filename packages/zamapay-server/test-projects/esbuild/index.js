import assert from "node:assert/strict"
import {
  ZamaPayApiError,
  ZamaPayConnectionError,
  ZamaPayError,
  ZamaPayRateLimitError,
} from "@zamapay/server"

const rateLimit = new ZamaPayRateLimitError("slow down", {
  code: "rate_limited",
  requestId: "req_install_shape",
  status: 429,
})

assert(rateLimit instanceof ZamaPayError)
assert(rateLimit instanceof ZamaPayApiError)
assert.equal(rateLimit.name, "ZamaPayRateLimitError")
assert.equal(rateLimit.requestId, "req_install_shape")

const connection = new ZamaPayConnectionError("socket closed")
assert(connection instanceof ZamaPayError)
assert.equal(connection.name, "ZamaPayConnectionError")
