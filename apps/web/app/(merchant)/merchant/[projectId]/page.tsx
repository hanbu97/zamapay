import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { PaymentProjectConsole, type ProjectConsoleTab } from '@/components/merchant/PaymentProjectConsole'
import { getOptionalSession, type BillingSubscriptionResponse, type ProjectDashboardOverview } from '@/lib/api'
import { isDemoDashboardProject } from '@/lib/demo-dashboard'
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
  const session = await getOptionalSession(cookieHeader)
  const isDemoDashboard = isDemoDashboardProject(projectId)

  if (!session.authenticated || !session.user) {
    if (isDemoDashboard) {
      return await renderDemoProjectPage({ cookieHeader, projectId, searchParams })
    }

    redirect(`/login?next=/merchant/${projectId}`)
  }

  const overviewResult = await loadMerchantProjectOverview(projectId, cookieHeader)

  if (overviewResult.status === 'unauthorized') {
    redirect(`/login?next=/merchant/${projectId}`)
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

  const overview = overviewResult.data
  const isOwnerSession = overview.project.ownerWallet.toLowerCase() === session.user.address.toLowerCase()

  if (!isOwnerSession) {
    if (isDemoDashboard) {
      return renderProjectConsole({
        initialBilling: null,
        ownerAddress: overview.project.ownerWallet,
        overview,
        readOnly: true,
        searchParams,
      })
    }

    notFound()
  }

  const billingResult = await loadMerchantBilling(cookieHeader)

  if (billingResult.status === 'unauthorized') {
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

  return renderProjectConsole({
    initialBilling: billingResult.data,
    ownerAddress: session.user.address,
    overview,
    readOnly: false,
    searchParams,
  })
}

async function renderDemoProjectPage({
  cookieHeader,
  projectId,
  searchParams,
}: {
  cookieHeader: string
  projectId: string
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const overviewResult = await loadMerchantProjectOverview(projectId, cookieHeader)

  if (overviewResult.status === 'unauthorized') {
    redirect(`/login?next=/merchant/${projectId}`)
  }
  if (overviewResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="The demo dashboard needs the selected project overview before checkout and settlement state can be shown."
        reason={overviewResult.reason}
        retryHref={`/merchant/${projectId}`}
        title="Demo dashboard"
      />
    )
  }
  if (!overviewResult.data) {
    notFound()
  }

  return renderProjectConsole({
    initialBilling: null,
    ownerAddress: overviewResult.data.project.ownerWallet,
    overview: overviewResult.data,
    readOnly: true,
    searchParams,
  })
}

async function renderProjectConsole({
  initialBilling,
  ownerAddress,
  overview,
  readOnly,
  searchParams,
}: {
  initialBilling: BillingSubscriptionResponse | null
  ownerAddress: string
  overview: ProjectDashboardOverview
  readOnly: boolean
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const paramsValue = searchParams ? await searchParams : {}
  const tab = typeof paramsValue.tab === 'string' ? (paramsValue.tab as ProjectConsoleTab) : undefined

  return (
    <div className="zamapay-flow-stack flex flex-col">
      <PageHeader
        badge={readOnly ? 'read only demo' : overview.project.defaultEnvironment.replace('_', ' ')}
        description={
          readOnly
            ? 'Public project dashboard for checkout sessions, webhook state, and settlement activity.'
            : 'Project-level API keys, webhook endpoints, checkout sessions, and settlement activity.'
        }
        title={overview.project.name}
      />

      <PaymentProjectConsole
        initialBilling={initialBilling}
        initialOverview={overview}
        initialTab={tab}
        ownerAddress={ownerAddress}
        readOnly={readOnly}
      />
    </div>
  )
}
