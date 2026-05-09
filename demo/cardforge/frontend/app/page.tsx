import {
  ArrowUpRightIcon,
  BadgeCheckIcon,
  Code2Icon,
  CreditCardIcon,
  HomeIcon,
} from 'lucide-react'
import { CardForgeFulfillmentPanel, CreateCheckoutButton } from '@/components/cardforge/CreateCheckoutButton'
import { ConfidentialWalletPanel } from '@/components/cardforge/ConfidentialWalletPanel'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cardForgeConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

const codes = ['SEA prepaid code', 'Game wallet code', 'Instant access code']

export default function CardForgePage() {
  const config = cardForgeConfig()
  const frontendLines = [
    `NEXT_PUBLIC_CARDFORGE_API_URL=${config.apiBaseUrl}`,
    `NEXT_PUBLIC_MERMER_PAY_CONSOLE_URL=${config.mermerConsoleUrl}`,
  ]

  return (
    <div className="min-h-screen bg-background xl:[--wallet-rail:clamp(340px,25vw,400px)]">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 xl:mr-[var(--wallet-rail)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <a className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-w-0 justify-start')} href="/">
            <HomeIcon data-icon="inline-start" />
            <span className="truncate">CardForge</span>
          </a>
          <a
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
            href={config.mermerConsoleUrl}
          >
            <span className="hidden sm:inline">Mermer Pay</span>
            <span className="sm:hidden">Pay</span>
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </div>
      </header>

      <main className="min-h-[calc(100vh-3.5rem)] px-4 py-5 md:px-8 md:py-8 xl:mr-[var(--wallet-rail)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <header className="flex flex-col gap-4 border-b pb-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-normal">CardForge</h1>
                <Badge variant="secondary">Standalone merchant demo</Badge>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                CardForge is a standalone card issuing template. Its frontend talks only to the CardForge backend; that
                backend owns Mermer Pay checkout creation, webhook callbacks, and release policy.
              </p>
            </div>
          </header>

          <section className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardAction>
                  <Badge>
                    <CreditCardIcon data-icon="inline-start" />
                    120 cUSDT
                  </Badge>
                </CardAction>
                <CardTitle>Prepaid card bundle</CardTitle>
                <CardDescription>CardForge owns product and delivery. Mermer Pay owns payment.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <Fact label="Product" value="Gaming card bundle" />
                  <Fact label="Delivery" value="3 demo codes" />
                  <Fact label="Payment provider" value="Mermer Pay hosted checkout" />
                  <Fact label="Release gate" value="payment.paid + finality.safe" />
                </div>

                <Separator />

                <CardForgeFulfillmentPanel codes={codes} config={config} />
              </CardContent>
            </Card>

            <div className="grid min-w-0 gap-4">
              <Card className="min-w-0">
                <CardHeader>
                  <CardAction>
                    <Badge variant="outline">
                      <BadgeCheckIcon data-icon="inline-start" />
                      Configured
                    </Badge>
                  </CardAction>
                  <CardTitle>Create Mermer Pay checkout</CardTitle>
                  <CardDescription>The demo backend creates the checkout and returns a hosted redirect.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CreateCheckoutButton config={config} />
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <CardAction>
                    <Badge variant="secondary">
                      <Code2Icon data-icon="inline-start" />
                      env
                    </Badge>
                  </CardAction>
                  <CardTitle>Merchant project config</CardTitle>
                  <CardDescription>Frontend values stay local to this template app.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="max-w-full overflow-x-auto rounded-lg border bg-muted p-3 text-xs leading-5 text-muted-foreground">
                    <code>{frontendLines.join('\n')}</code>
                  </pre>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </main>

      <aside className="px-4 pb-6 md:px-8 xl:fixed xl:right-0 xl:top-0 xl:z-30 xl:flex xl:h-screen xl:w-[var(--wallet-rail)] xl:flex-col xl:overflow-y-auto xl:border-l xl:bg-background xl:px-4 xl:py-6">
        <ConfidentialWalletPanel
          className="xl:h-full xl:rounded-none xl:border-0 xl:bg-transparent xl:shadow-none"
          config={config}
        />
      </aside>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  )
}
