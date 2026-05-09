import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { MerchantBillingPanel } from '@/components/merchant/MerchantBillingPanel'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { getSession } from '@/lib/api'
import { loadMerchantBilling } from '@/lib/merchant-portal'

export default async function BillingUpgradePage() {
  const cookieHeader = (await cookies()).toString()
  const session = await getSession(cookieHeader)

  if (!session.authenticated || !session.user) {
    redirect('/login?next=/billing/upgrade')
  }

  const billingResult = await loadMerchantBilling(cookieHeader)
  if (billingResult.status === 'unauthorized') {
    redirect('/login?next=/billing/upgrade')
  }
  if (billingResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Billing upgrades need the Rust subscription endpoints before private subscription payments can be managed."
        reason={billingResult.reason}
        retryHref="/billing/upgrade"
        title="Upgrade"
      />
    )
  }

  return (
    <div className="flex flex-col">
      <MerchantBillingPanel initialBilling={billingResult.data} ownerAddress={session.user.address} />
    </div>
  )
}
