import Link from 'next/link'
import { ArrowRightIcon, RotateCwIcon, ServerCrashIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'

type MerchantPortalUnavailableProps = {
  description: string
  reason: string
  retryHref: string
  title: string
}

export function MerchantPortalUnavailable({
  description,
  reason,
  retryHref,
  title,
}: MerchantPortalUnavailableProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader badge="API unavailable" description={description} title={title} />
      <Alert variant="destructive">
        <ServerCrashIcon data-icon="inline-start" />
        <AlertTitle>Merchant payment API is not ready</AlertTitle>
        <AlertDescription>{reason}</AlertDescription>
      </Alert>
      <ButtonGroup className="w-fit flex-wrap">
        <Button nativeButton={false} render={<Link href={retryHref} />}>
          <RotateCwIcon data-icon="inline-start" />
          Retry
        </Button>
        <Button nativeButton={false} render={<Link href={`/login?next=${encodeURIComponent(retryHref)}`} />} variant="outline">
          Sign in again
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </ButtonGroup>
    </div>
  )
}
