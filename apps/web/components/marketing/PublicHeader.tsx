import Link from "next/link"
import { ArrowRightIcon, BookOpenIcon, LayoutDashboardIcon, PlayCircleIcon } from "lucide-react"

import { docsPages } from "@/app/docs/docs-content"
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

const docsMenuItems = [
  {
    description: "Start with the full ZamaPay integration map.",
    href: "/docs",
    icon: BookOpenIcon,
    title: "Docs home",
  },
  ...docsPages.map((page) => ({
    description: page.description,
    href: `/docs/${page.slug}`,
    icon: page.icon,
    title: page.title,
  })),
]

type PublicHeaderProps = {
  isAuthenticated: boolean
}

export function PublicHeader({ isAuthenticated }: PublicHeaderProps) {
  const dashboardHref = isAuthenticated ? "/dashboard" : "/login?next=/dashboard"

  return (
    <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/78">
      <div className="mx-auto grid h-14 w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 md:px-8">
        <Link className="flex min-w-0 items-center gap-2 justify-self-start font-semibold" href="/">
          <img alt="" aria-hidden="true" className="size-8 shrink-0 rounded-md border object-cover" src={brandLogo.src} />
          <span className="truncate">ZamaPay</span>
        </Link>

        <div className="flex items-center justify-center gap-1 justify-self-center">
          <div className="flex items-center gap-1 pr-2 md:pr-4">
            <Button nativeButton={false} render={<Link href={demoDashboardHref} />} size="sm" variant="ghost">
              <LayoutDashboardIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Demo Dashboard</span>
              <span className="sm:hidden">Dashboard</span>
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

          <div className="flex items-center gap-1 pl-2 md:pl-4">
            <NavigationMenu className="flex">
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="h-9 gap-1.5 rounded-full px-3 text-sm">
                    <BookOpenIcon className="size-4" />
                    Docs
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[440px] max-w-[calc(100vw-2rem)] gap-0.5 p-2.5">
                      {docsMenuItems.map((item) => {
                        const Icon = item.icon

                        return (
                          <NavigationMenuLink
                            className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 hover:bg-muted/70"
                            key={item.href}
                            render={<Link href={item.href} />}
                          >
                            <span className="grid size-9 place-items-center rounded-lg border bg-background text-foreground shadow-sm [&_svg]:size-4">
                              <Icon />
                            </span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="text-sm font-semibold leading-tight">{item.title}</span>
                              <span className="line-clamp-1 text-xs leading-4 text-muted-foreground">
                                {item.description}
                              </span>
                            </span>
                          </NavigationMenuLink>
                        )
                      })}
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>

            <Button nativeButton={false} render={<Link href="/pricing" />} size="sm" variant="ghost">
              Pricing
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
