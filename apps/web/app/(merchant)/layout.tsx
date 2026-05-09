import { cookies } from 'next/headers'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { TopBar } from '@/components/layout/TopBar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getOptionalSession } from '@/lib/api'
import { loadMerchantBilling } from '@/lib/merchant-portal'

export default async function MerchantLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieHeader = (await cookies()).toString()
  const session = await getOptionalSession(cookieHeader)
  const isAuthenticated = Boolean(session.authenticated && session.user)
  const billing = isAuthenticated ? await loadMerchantBilling(cookieHeader) : null
  const subscriptionPlan = billing?.status === 'ready' ? billing.data.subscription.plan : null
  const userAddress = session.user?.address ?? null

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar isAuthenticated={isAuthenticated} />
        <SidebarInset>
          <TopBar isAuthenticated={isAuthenticated} subscriptionPlan={subscriptionPlan} userAddress={userAddress} />
          <main className="mermer-page-shell flex flex-1 flex-col">
            <div className="mermer-content-stack mx-auto flex flex-col">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
