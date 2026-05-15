import { buildInstallSurface } from "@/app/docs/docs-content"
import { requestOrigin } from "@/app/docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const origin = requestOrigin(request)
  const install = buildInstallSurface(origin)
  return Response.json({
    install,
    skills: [
      {
        name: "zamapay",
        description:
          "Integrate ZamaPay hosted checkout, explicit payment rails, and raw-body webhook verification safely.",
        url: `${origin}/.well-known/skills/zamapay`,
        llmsUrl: `${origin}/llms.txt`,
        installUrl: install.skillInstallUrl,
      },
    ],
  })
}
