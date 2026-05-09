import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { MerchantProjectsOverview } from '@/components/merchant/MerchantProjectsOverview'
import { MerchantPortalUnavailable } from '@/components/merchant/MerchantPortalUnavailable'
import { PageHeader } from '@/components/layout/PageHeader'
import { getSession } from '@/lib/api'
import { loadMerchantProjects } from '@/lib/merchant-portal'

export default async function MerchantPage() {
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
        title="Projects"
      />
    )
  }

  return (
    <div className="mermer-flow-stack flex flex-col">
      <PageHeader
        description="Create, search, and open merchant payment projects."
        title="Projects"
      />

      <MerchantProjectsOverview initialProjects={projectsResult.data} />
    </div>
  )
}
