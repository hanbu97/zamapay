import { buildDocsManifest } from "@/app/docs/docs-content"
import { requestOrigin } from "@/app/docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  return Response.json(buildDocsManifest(requestOrigin(request)))
}
