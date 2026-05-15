import Link from "next/link"
import { ArrowRightIcon, BotIcon, BookOpenIcon, LayoutDashboardIcon, PlayCircleIcon } from "lucide-react"

import { docsEntryPoints, docsTopCategories } from "@/app/docs/docs-content"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { demoDashboardHref } from "@/lib/demo-dashboard"
import { cn } from "@/lib/utils"
import brandLogo from "../../../../assets/logo.svg"

const demoUrl = "https://demo.zamapay.org"

const docsHomeItem = {
  description: "Start with the full ZamaPay integration map.",
  href: "/docs",
  icon: BookOpenIcon,
  title: "Docs home",
}

type PublicHeaderProps = {
  isAuthenticated: boolean
}

export function PublicHeader({ isAuthenticated }: PublicHeaderProps) {
  const dashboardHref = isAuthenticated ? "/dashboard" : "/login?next=/dashboard"

  return (
    <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/78">
      <div className="mx-auto grid h-14 w-full max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 md:px-8">
        <Link className="flex min-w-0 items-center gap-2 justify-self-start font-semibold" href="/">
          <img alt="" aria-hidden="true" className="size-8 shrink-0 rounded-md border object-cover" src={brandLogo.src} />
          <span className="truncate">ZamaPay</span>
        </Link>

        <div className="flex min-w-0 items-center justify-center gap-1 justify-self-center">
          <div className="hidden items-center gap-1 pr-2 md:flex md:pr-4">
            <Button nativeButton={false} render={<Link href={demoDashboardHref} />} size="sm" variant="ghost">
              <LayoutDashboardIcon data-icon="inline-start" />
              Demo Dashboard
            </Button>

            <a
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "gap-1.5")}
              href={demoUrl}
              rel="noreferrer"
              target="_blank"
            >
              <PlayCircleIcon data-icon="inline-start" />
              Demo
            </a>
          </div>

          <div className="flex min-w-0 items-center gap-1 md:pl-4">
            <NavigationMenu align="center" className="flex">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger
                    className="h-9 rounded-full px-3 text-sm font-medium [&>svg:last-child]:ml-1.5"
                    nativeButton={false}
                    render={<Link href="/docs" />}
                  >
                    <BookOpenIcon className="size-4" />
                    Docs
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid max-h-[min(36rem,calc(100dvh-5rem))] w-[min(64rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-5 overflow-y-auto p-4 md:grid-cols-[15rem_minmax(0,1fr)]">
                      <NavigationMenuLink
                        className="grid content-start gap-3 rounded-xl border bg-muted/35 p-4 hover:bg-muted/60"
                        render={<Link href={docsHomeItem.href} />}
                      >
                        <span className="grid size-11 place-items-center rounded-lg border bg-background text-foreground shadow-sm [&_svg]:size-5">
                          <docsHomeItem.icon />
                        </span>
                        <span className="grid gap-1">
                          <span className="text-base font-semibold leading-tight">{docsHomeItem.title}</span>
                          <span className="text-sm leading-5 text-muted-foreground">{docsHomeItem.description}</span>
                        </span>
                        <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium">
                          Open docs
                          <ArrowRightIcon className="size-3.5" />
                        </span>
                      </NavigationMenuLink>

                      <div className="grid gap-5">
                        <div className="grid gap-2">
                          <div className="px-1 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                            Start with a goal
                          </div>
                          <div className="grid gap-0.5 sm:grid-cols-2">
                            {docsEntryPoints.slice(0, 4).map((entry) => {
                              const Icon = entry.page.icon

                              return (
                                <NavigationMenuLink
                                  className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 hover:bg-muted/70"
                                  key={entry.page.slug}
                                  render={<Link href={entry.href} />}
                                >
                                  <span className="grid size-9 place-items-center rounded-lg border bg-background text-foreground shadow-sm [&_svg]:size-4">
                                    <Icon />
                                  </span>
                                  <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-sm font-semibold leading-tight">{entry.title}</span>
                                    <span className="line-clamp-1 text-xs leading-4 text-muted-foreground">
                                      {entry.description}
                                    </span>
                                  </span>
                                </NavigationMenuLink>
                              )
                            })}
                          </div>
                        </div>

                        <div className="grid gap-2">
                          <div className="px-1 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                            Browse by stage
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                            {docsTopCategories.map((category) => (
                              <NavigationMenuLink
                                className="grid gap-1 rounded-lg border bg-card p-3 hover:bg-muted/50"
                                key={category.title}
                                render={<Link href={category.href} />}
                              >
                                <span className="text-sm font-semibold leading-tight">{category.title}</span>
                                <span className="line-clamp-2 text-xs leading-4 text-muted-foreground">
                                  {category.description}
                                </span>
                              </NavigationMenuLink>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <Button className="hidden md:inline-flex" nativeButton={false} render={<Link href="/pricing" />} size="sm" variant="ghost">
              Pricing
            </Button>
            <Button className="hidden md:inline-flex" nativeButton={false} render={<Link href="/agents" />} size="sm" variant="ghost">
              <BotIcon data-icon="inline-start" />
              Agents
            </Button>
          </div>
        </div>

        <Button className="justify-self-end" nativeButton={false} render={<Link href={dashboardHref} />} size="sm">
          {isAuthenticated ? "Dashboard" : "Log in"}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </header>
  )
}
