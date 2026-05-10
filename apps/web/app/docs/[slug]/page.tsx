import { notFound } from "next/navigation"

import { DocsArticle } from "../DocsArticle"
import { docsBySlug, docsPages } from "../docs-content"

export function generateStaticParams() {
  return docsPages.map((page) => ({
    slug: page.slug,
  }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = docsBySlug.get(slug)

  if (!page) {
    return {
      title: "Docs - ZamaPay",
    }
  }

  return {
    description: page.description,
    title: `${page.title} - ZamaPay Docs`,
  }
}

export default async function DocsSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = docsBySlug.get(slug)

  if (!page) {
    notFound()
  }

  return <DocsArticle page={page} />
}
