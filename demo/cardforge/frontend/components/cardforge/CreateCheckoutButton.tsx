'use client'

import { useEffect, useState } from 'react'
import { ArrowRightIcon, KeyRoundIcon, RotateCwIcon, Settings2Icon, ShoppingCartIcon } from 'lucide-react'
import type { CardForgeConfig } from '@/lib/config'
import {
  CardForgeApiError,
  type FulfillmentSnapshot,
  createCardForgeCheckout,
  getCardForgeFulfillment,
} from '@/lib/cardforge-api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
      const fee = formatMinorUnits(checkout.billing.platformFeeMinorUnits)
      const net = formatMinorUnits(checkout.billing.merchantNetMinorUnits)

      setStatus(`Checkout ${checkout.checkoutSessionId} created. Mermer Pay fee ${fee}; merchant receives ${net}. Redirecting...`)
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

type CardForgeFulfillmentPanelProps = {
  codes: string[]
  config: CardForgeConfig
}

export function CardForgeFulfillmentPanel({ codes, config }: CardForgeFulfillmentPanelProps) {
  const [error, setError] = useState<string | null>(null)
  const [fulfillment, setFulfillment] = useState<FulfillmentSnapshot | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function refreshFulfillment() {
    setIsRefreshing(true)
    setError(null)

    try {
      setFulfillment(await getCardForgeFulfillment(config))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Fulfillment status is unavailable.')
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void refreshFulfillment()
  }, [])

  const releasedCards = new Map((fulfillment?.cards ?? []).map((card) => [card.label, card.secret]))

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <Badge variant={fulfillment?.released ? 'default' : 'secondary'}>
          <KeyRoundIcon data-icon="inline-start" />
          {fulfillment?.released ? 'Released' : 'Locked'}
        </Badge>
        <Button disabled={isRefreshing} onClick={refreshFulfillment} size="sm" type="button" variant="outline">
          <RotateCwIcon data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Fulfillment status unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {codes.map((code) => {
        const secret = releasedCards.get(code)

        return (
          <div className="flex items-start gap-3 rounded-lg border px-3 py-3" key={code}>
            <KeyRoundIcon className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{code}</div>
              <div className="text-sm text-muted-foreground">
                {secret ?? 'Locked until Mermer Pay callback releases it.'}
              </div>
            </div>
            <Badge variant={secret ? 'default' : 'secondary'}>{secret ? 'Released' : 'Locked'}</Badge>
          </div>
        )
      })}

      {fulfillment?.latestRelease ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Latest release: {fulfillment.latestRelease.checkoutSessionId}
        </p>
      ) : null}
    </div>
  )
}

function formatMinorUnits(value: number) {
  return `${(value / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  })} cUSDT`
}
