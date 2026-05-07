import { cookies } from 'next/headers'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getOptionalSession } from '@/lib/api'

export default async function MerchantLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar isAuthenticated={isAuthenticated} />
        <SidebarInset>
          <TopBar isAuthenticated={isAuthenticated} />
          <main className="flex flex-1 flex-col px-4 py-6 md:px-6 lg:px-8">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
