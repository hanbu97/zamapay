import { cookies } from "next/headers"
import type { ReactNode } from "react"

import { PublicHeader } from "@/components/marketing/PublicHeader"
import { getOptionalSession } from "@/lib/api"

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <PublicHeader isAuthenticated={isAuthenticated} />
      <div className="min-h-[calc(100dvh-3.5rem)]">{children}</div>
    </main>
  )
}
