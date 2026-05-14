import Link from "next/link"
import { ArrowRightIcon, BookOpenIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"

import { docsBrowseSections, docsEntryPoints, docsTopCategories } from "./docs-content"

export default function DocsHomePage() {
  return (
    <section className="w-full">
      <div className="login-product-bg border-b">
        <div className="mx-auto grid min-h-[28rem] w-full max-w-7xl items-center gap-10 px-4 py-16 md:px-8 md:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.55fr)]">
          <div className="min-w-0">
            <div className="grid max-w-3xl gap-4">
              <Badge className="w-fit" variant="secondary">
                Documentation
              </Badge>
              <h1 className="text-4xl font-semibold leading-tight tracking-normal md:text-6xl">
                Build with ZamaPay
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Explore guides and examples for accepting hosted payments, choosing a rail, verifying signed webhooks,
                and running the local development workflow.
              </p>
            </div>
          </div>

          <div className="grid content-start gap-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 font-medium">
              <BookOpenIcon className="size-4" />
              Popular paths
            </div>
            <div className="grid gap-2">
              {docsEntryPoints.slice(0, 4).map((entry) => {
                const Icon = entry.page.icon

                return (
                  <Link
                    className="group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-background p-2.5 transition hover:border-foreground/20 hover:bg-muted/60"
                    href={entry.href}
                    key={entry.page.slug}
                  >
                    <span className="grid size-9 place-items-center rounded-md border bg-card text-foreground [&_svg]:size-4">
                      <Icon />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight">{entry.title}</span>
                      <span className="line-clamp-1 block text-xs leading-5 text-muted-foreground">
                        {entry.description}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition group-hover:text-foreground">
                      Open
                      <ArrowRightIcon className="size-3.5 transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-4 md:px-8">
        <div className="pt-14">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-normal">Browse by stage</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Start with the phase of integration you are working through.
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {docsTopCategories.map((category) => (
              <section
                className="grid content-start gap-4 rounded-lg border bg-card p-4"
                id={category.href.slice(6)}
                key={category.title}
              >
                <div>
                  <div className="text-sm font-semibold">{category.title}</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{category.description}</p>
                </div>
                <ul className="grid list-none gap-2 p-0">
                  {category.pages.slice(0, 3).map((page) => (
                    <li key={page.slug}>
                      <Link
                        className="group flex min-h-9 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:border-foreground/20 hover:bg-muted/55"
                        href={`/docs/${page.slug}`}
                      >
                        <span>{page.title}</span>
                        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="mt-12">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-normal">Start with a goal</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Pick the integration outcome first. Each path opens the exact guide you need instead of a flat document list.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {docsEntryPoints.map((entry) => {
              const Icon = entry.page.icon

              return (
                <Link
                  className="group grid min-h-full content-start gap-4 rounded-lg border bg-card p-5 transition hover:border-foreground/20 hover:bg-muted/45 hover:shadow-sm"
                  href={entry.href}
                  key={entry.page.slug}
                >
                  <span className="grid gap-3">
                    <Badge className="w-fit" variant="secondary">
                      <Icon data-icon="inline-start" />
                      {entry.action}
                    </Badge>
                    <span className="text-xl font-semibold tracking-normal">{entry.title}</span>
                    <span className="text-sm leading-6 text-muted-foreground">{entry.description}</span>
                  </span>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition group-hover:text-foreground">
                    Open guide
                    <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="mt-14">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-normal">Browse by capability</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Use this when you already know the ZamaPay surface you want to work on.
            </p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {docsBrowseSections.map((section) => (
              <section
                className="rounded-lg border bg-card p-5"
                id={`capability-${section.title.toLowerCase().replace(/\s+/g, "-")}`}
                key={section.title}
              >
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-semibold tracking-normal">{section.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{section.description}</p>
                </div>
                <div className="mt-4 grid gap-1">
                  {section.pages.map((page) => {
                    const Icon = page.icon

                    return (
                      <Link
                        className="group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md border bg-background p-2.5 transition hover:border-foreground/20 hover:bg-muted/60"
                        href={`/docs/${page.slug}`}
                        key={page.slug}
                      >
                        <span className="grid size-9 place-items-center rounded-md border bg-card [&_svg]:size-4">
                          <Icon />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{page.title}</span>
                          <span className="line-clamp-1 block text-xs leading-5 text-muted-foreground">
                            {page.description}
                          </span>
                        </span>
                        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </Link>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
