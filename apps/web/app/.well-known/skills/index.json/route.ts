import { requestOrigin } from "@/app/docs/request-origin"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  const origin = requestOrigin(request)
  return Response.json({
    skills: [
      {
        name: "zamapay",
        description:
          "Integrate ZamaPay hosted checkout, explicit payment rails, and raw-body webhook verification safely.",
        url: `${origin}/.well-known/skills/zamapay`,
        llmsUrl: `${origin}/llms.txt`,
      },
    ],
  })
}
