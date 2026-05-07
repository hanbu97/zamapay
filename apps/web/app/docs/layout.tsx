import Link from "next/link"
import { cookies } from "next/headers"
import type { ReactNode } from "react"
import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getOptionalSession } from "@/lib/api"

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)
  const consoleHref = isAuthenticated ? "/merchant" : "/login?next=/merchant"

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/78">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
          <Link className="flex min-w-0 items-center gap-2 font-semibold" href="/">
            <span className="grid size-8 place-items-center rounded-md border bg-muted text-xs">MP</span>
            <span className="truncate">Mermer Pay</span>
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <Link className="text-foreground" href="/docs">
              Docs
            </Link>
            <Link className="hover:text-foreground" href="/#platform">
              Platform
            </Link>
            <Link className="hover:text-foreground" href="/#workflow">
              Workflow
            </Link>
            <Link className="hover:text-foreground" href="/#developers">
              Developers
            </Link>
          </nav>
          <Button nativeButton={false} render={<Link href={consoleHref} />} size="sm">
            {isAuthenticated ? "Console" : "Log in"}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </header>

      <div className="min-h-[calc(100dvh-3.5rem)]">{children}</div>
    </main>
  )
}
