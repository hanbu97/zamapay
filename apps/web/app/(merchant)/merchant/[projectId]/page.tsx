import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { PaymentProjectConsole, type ProjectConsoleTab } from '@/components/merchant/PaymentProjectConsole'
import { getSession } from '@/lib/api'
import { loadMerchantBilling, loadMerchantProjectOverview } from '@/lib/merchant-portal'

type ProjectPageProps = {
  params: Promise<{
    projectId: string
  }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { projectId } = await params
  const cookieHeader = (await cookies()).toString()
  const session = await getSession(cookieHeader)

  if (!session.authenticated || !session.user) {
    redirect(`/login?next=/merchant/${projectId}`)
  }

  const [billingResult, overviewResult] = await Promise.all([
    loadMerchantBilling(cookieHeader),
    loadMerchantProjectOverview(projectId, cookieHeader),
  ])

  if (billingResult.status === 'unauthorized' || overviewResult.status === 'unauthorized') {
    redirect(`/login?next=/merchant/${projectId}`)
  }
  if (billingResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Project settings need the billing subscription snapshot to quote new checkout fees."
        reason={billingResult.reason}
        retryHref={`/merchant/${projectId}`}
        title="Project billing"
      />
    )
  }
  if (overviewResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Project settings need the selected project overview before keys, webhooks, and checkout sessions can be managed."
        reason={overviewResult.reason}
        retryHref={`/merchant/${projectId}`}
        title="Project settings"
      />
    )
  }
  if (!overviewResult.data) {
    notFound()
  }

  const paramsValue = searchParams ? await searchParams : {}
  const tab = typeof paramsValue.tab === 'string' ? (paramsValue.tab as ProjectConsoleTab) : undefined
  const overview = overviewResult.data

  return (
    <div className="mermer-flow-stack flex flex-col">
      <PageHeader
        badge={overview.project.defaultEnvironment.replace('_', ' ')}
        description="Project-level API keys, webhook endpoints, checkout sessions, and diagnostics."
        title={overview.project.name}
      />

      <PaymentProjectConsole
        initialBilling={billingResult.data}
        initialOverview={overview}
        initialTab={tab}
        ownerAddress={session.user.address}
      />
    </div>
  )
}
