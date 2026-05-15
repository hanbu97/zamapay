import { buildCliInstallScript } from "../install-scripts"
import { requestOrigin } from "../docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request): Response {
  return new Response(buildCliInstallScript(requestOrigin(request)), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/x-shellscript; charset=utf-8",
    },
  })
}
