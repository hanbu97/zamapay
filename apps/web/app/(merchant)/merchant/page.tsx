import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ArrowRightIcon } from 'lucide-react'
import { PaymentProjectConsole } from '@/components/merchant/PaymentProjectConsole'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { getSession } from '@/lib/api'
import { loadMerchantProjectOverview, loadMerchantProjects } from '@/lib/merchant-portal'

type MerchantPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function MerchantPage({ searchParams }: MerchantPageProps) {
  const cookieHeader = (await cookies()).toString()
  const session = await getSession(cookieHeader)

  if (!session.authenticated || !session.user) {
    redirect('/login?next=/merchant')
  }

  const projectsResult = await loadMerchantProjects(cookieHeader)
  if (projectsResult.status === 'unauthorized') {
    redirect('/login?next=/merchant')
  }
  if (projectsResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Project settings need the Rust merchant project endpoints before keys, webhooks, and checkout sessions can be managed."
        reason={projectsResult.reason}
        retryHref="/merchant"
        title="Merchant projects"
      />
    )
  }

  const projects = projectsResult.data
  const params = searchParams ? await searchParams : {}
  const requestedProjectId = typeof params.projectId === 'string' ? params.projectId : null
  const selectedProjectId = requestedProjectId ?? projects[0]?.projectId ?? null
  const overviewResult = selectedProjectId
    ? await loadMerchantProjectOverview(selectedProjectId, cookieHeader)
    : ({ data: null, status: 'ready' } as const)
  if (overviewResult.status === 'unauthorized') {
    redirect('/login?next=/merchant')
  }
  if (overviewResult.status === 'unavailable') {
    return (
      <MerchantPortalUnavailable
        description="Project settings need the selected project overview before keys, webhooks, and checkout sessions can be managed."
        reason={overviewResult.reason}
        retryHref="/merchant"
        title="Merchant projects"
      />
    )
  }

  const overview = overviewResult.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        actions={
          <ButtonGroup>
            <Button nativeButton={false} render={<Link href="/dashboard" />} size="lg">
              Payments
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Button nativeButton={false} render={<Link href="/ops" />} size="lg" variant="outline">
              Diagnostics
            </Button>
          </ButtonGroup>
        }
        badge="Project scoped"
        description="Create merchant payment projects, issue server-side API keys, configure signed webhooks, and inspect checkout sessions from one project-owned console."
        title="Merchant projects"
      />

      <PaymentProjectConsole initialOverview={overview} initialProjects={projects} ownerAddress={session.user.address} />
    </div>
  )
}
