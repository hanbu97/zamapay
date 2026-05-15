import { buildIntegrationManifest } from "../../docs/docs-content"
import { requestOrigin } from "../../docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request): Response {
  return Response.json(buildIntegrationManifest(requestOrigin(request)), {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
