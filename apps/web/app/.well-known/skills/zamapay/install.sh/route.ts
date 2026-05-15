import { requestOrigin } from "../../../../docs/request-origin"
import { buildSkillInstallScript } from "../../../../install-scripts"

export const dynamic = "force-dynamic"

export function GET(request: Request): Response {
  return new Response(buildSkillInstallScript(requestOrigin(request)), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "text/x-shellscript; charset=utf-8",
    },
  })
}
