import { buildLlmsTxt } from "@/app/docs/docs-content"
import { requestOrigin } from "@/app/docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return new Response(buildLlmsTxt(requestOrigin(request)), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  })
}
