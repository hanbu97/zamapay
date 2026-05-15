import { buildLlmsFullTxt } from "@/app/docs/docs-content"
import { requestOrigin } from "@/app/docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return new Response(buildLlmsFullTxt(requestOrigin(request)), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  })
}
