import { docsMarkdownSlugs, markdownForDocsPage } from "../../docs-content"
import { requestOrigin } from "../../request-origin"

export const dynamic = "force-dynamic"

export function generateStaticParams() {
  return docsMarkdownSlugs()
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = markdownForDocsPage(slug, requestOrigin(request))
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
    },
  })
}
