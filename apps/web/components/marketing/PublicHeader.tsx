import Link from "next/link"
import { ArrowRightIcon, BookOpenIcon } from "lucide-react"

import { docsPages } from "@/app/docs/docs-content"
import { Button } from "@/components/ui/button"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"

const docsMenuItems = [
  {
    description: "Start with the full Mermer Pay integration map.",
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
          <span className="grid size-8 place-items-center rounded-md border bg-muted text-xs">MP</span>
          <span className="truncate">Mermer Pay</span>
        </Link>

        <div className="flex items-center justify-center gap-1 justify-self-center">
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

        <Button className="justify-self-end" nativeButton={false} render={<Link href={dashboardHref} />} size="sm">
          {isAuthenticated ? "Dashboard" : "Log in"}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </header>
  )
}
