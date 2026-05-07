'use client'

import { useState } from 'react'
import { ArrowRightIcon, Settings2Icon, ShoppingCartIcon } from 'lucide-react'
import type { CardForgeConfig } from '@/lib/config'
import { CardForgeApiError, createCardForgeCheckout } from '@/lib/cardforge-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

type CreateCheckoutButtonProps = {
  config: CardForgeConfig
}

export function CreateCheckoutButton({ config }: CreateCheckoutButtonProps) {
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [status, setStatus] = useState('Ready to ask the CardForge backend for a hosted checkout.')

  async function handleCreateCheckout() {
    setIsBusy(true)
    setError(null)
    setStatus('Requesting checkout from the CardForge backend...')

    try {
      const checkout = await createCardForgeCheckout(config)

      setStatus(`Checkout ${checkout.checkoutSessionId} created on chain invoice ${checkout.chainInvoiceId}. Redirecting to Mermer Pay...`)
      window.location.assign(checkout.checkoutUrl)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Checkout creation failed.'
      if (caught instanceof CardForgeApiError && caught.code === 'mermer_project_auth_failed') {
        setStatus('CardForge backend needs a valid Mermer Pay project API key.')
        setError(message)
        return
      }

      setError(message)
      setStatus('Checkout creation did not complete.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert>
        <AlertTitle>Checkout status</AlertTitle>
        <AlertDescription>{status}</AlertDescription>
      </Alert>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>CardForge backend request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button className="w-full" disabled={isBusy} onClick={handleCreateCheckout} type="button">
        {isBusy ? <ArrowRightIcon data-icon="inline-start" /> : <ShoppingCartIcon data-icon="inline-start" />}
        {isBusy ? 'Creating checkout...' : 'Create hosted checkout'}
      </Button>

      <a
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent"
        href={config.mermerConsoleUrl}
      >
        <Settings2Icon data-icon="inline-start" />
        Mermer Pay console
      </a>
    </div>
  )
}
