import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { docsPages, featuredDocs } from "./docs-content"

export default function DocsHomePage() {
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 md:px-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-24 flex flex-col gap-2">
          <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Docs map</div>
          {docsPages.map((page) => (
            <Button
              className="justify-start"
              key={page.slug}
              nativeButton={false}
              render={<Link href={`/docs/${page.slug}`} />}
              size="sm"
              variant="ghost"
            >
              <page.icon data-icon="inline-start" />
              {page.title}
            </Button>
          ))}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="flex flex-col gap-3">
          <Badge className="w-fit" variant="secondary">
            Documentation
          </Badge>
          <h1 className="text-4xl font-semibold tracking-normal">Documentation paths</h1>
          <p className="max-w-3xl leading-7 text-muted-foreground">
            Start with the successful merchant payment loop, then read the API boundary, webhook delivery model,
            CardForge template wiring, and environment proof.
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {featuredDocs.map((page) => {
            const Icon = page.icon

            return (
              <Card className="landing-card-hover" key={page.slug}>
                <CardHeader>
                  <Badge className="w-fit" variant="secondary">
                    <Icon data-icon="inline-start" />
                    {page.badge}
                  </Badge>
                  <CardTitle>{page.title}</CardTitle>
                  <CardDescription>{page.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button nativeButton={false} render={<Link href={`/docs/${page.slug}`} />} size="sm" variant="outline">
                    Read guide
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
