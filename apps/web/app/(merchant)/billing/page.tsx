import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { MerchantBillingOverview } from '@/components/merchant/MerchantBillingOverview'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { getSession } from '@/lib/api'
import { loadMerchantBilling } from '@/lib/merchant-portal'

export default async function BillingPage() {
  const cookieHeader = (await cookies()).toString()
  const session = await getSession(cookieHeader)

  if (!session.authenticated || !session.user) {
    redirect('/login?next=/billing')
  }

  const billingResult = await loadMerchantBilling(cookieHeader)
  if (billingResult.status === 'unauthorized') {
    redirect('/login?next=/billing')
  }
  if (billingResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Billing settings need the Rust subscription endpoints before private subscription upgrades can be managed."
        reason={billingResult.reason}
        retryHref="/billing"
        title="Billing"
      />
    )
  }

  return (
    <div className="flex flex-col">
      <MerchantBillingOverview billing={billingResult.data} />
    </div>
  )
}
