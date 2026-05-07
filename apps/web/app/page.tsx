import Link from "next/link"
import { cookies } from "next/headers"
import {
  ArrowRightIcon,
  BlocksIcon,
  BracesIcon,
  CheckCircle2Icon,
  CircleDollarSignIcon,
  LockKeyholeIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  StoreIcon,
  WebhookIcon,
} from "lucide-react"

import { LandingProductMotion } from "@/components/landing/LandingProductMotion"
import { PublicFooter } from "@/components/marketing/PublicFooter"
import { PublicHeader } from "@/components/marketing/PublicHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { getOptionalSession } from "@/lib/api"

const proofItems = ["Hosted checkout", "Wallet login", "Encrypted settlement", "Finality gate", "Webhook release"]

const platformPillars = [
  {
    description: "Merchants create projects, issue checkout URLs, and keep invoice state in one operational console.",
    icon: ReceiptTextIcon,
    title: "Checkout components",
  },
  {
    description: "Payment amount checks stay encrypted on the Zama rail until the authorized merchant decrypts.",
    icon: LockKeyholeIcon,
    title: "Confidential settlement",
  },
  {
    description: "Release digital goods only after payment truth, chain finality, and webhook delivery agree.",
    icon: WebhookIcon,
    title: "Fulfillment webhooks",
  },
]

const operationFrames = [
  {
    action: "Create project",
    description: "Merchant configures checkout, callback URL, and settlement authority.",
    icon: StoreIcon,
    metric: "project live",
    title: "Merchant console",
  },
  {
    action: "Buyer pays",
    description: "Hosted checkout keeps the merchant app out of payment infrastructure.",
    icon: CircleDollarSignIcon,
    metric: "120 cUSDT",
    title: "Hosted checkout",
  },
  {
    action: "Verify rail",
    description: "Operator projection waits for payment truth and finality-safe confirmation.",
    icon: ShieldCheckIcon,
    metric: "2 / 2 blocks",
    title: "Finality monitor",
  },
  {
    action: "Release order",
    description: "Webhook dispatch tells the merchant backend when payment is finality-safe.",
    icon: WebhookIcon,
    metric: "release ready",
    title: "Webhook callback",
  },
]

const boundaryRows = [
  ["Merchant frontend", "catalog, buyer journey, order copy"],
  ["Merchant backend", "order id, callback endpoint, fulfillment release"],
  ["Mermer Pay", "checkout session, payment truth, finality, encrypted settlement"],
]

export default async function SiteHomePage() {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)
  const consoleHref = isAuthenticated ? "/merchant" : "/login?next=/merchant"
  const opsHref = isAuthenticated ? "/ops" : "/login?next=/ops"

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <PublicHeader isAuthenticated={isAuthenticated} />

      <section className="landing-grid-bg border-b">
        <div className="mx-auto grid min-h-[78svh] w-full max-w-7xl items-center gap-10 px-4 py-12 md:px-8 lg:grid-cols-[0.84fr_1.16fr]">
          <div className="flex min-w-0 flex-col gap-6">
            <h1 className="max-w-3xl text-5xl font-semibold leading-none tracking-normal text-balance md:text-7xl">
              Private checkout infrastructure for crypto merchants
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
              Mermer Pay gives merchant products a hosted crypto checkout, wallet-gated project console, encrypted Zama
              settlement, and finality-safe webhook release without mixing payment state into the merchant app.
            </p>
            <ButtonGroup className="w-fit flex-wrap">
              <Button nativeButton={false} render={<Link href={consoleHref} />} size="lg">
                {isAuthenticated ? "Open merchant console" : "Log in"}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button nativeButton={false} render={<a href="#developers" />} size="lg" variant="outline">
                View integration flow
              </Button>
              <Button nativeButton={false} render={<Link href="/docs" />} size="lg" variant="outline">
                Read docs
              </Button>
            </ButtonGroup>
            <div className="landing-proof-strip hidden max-w-2xl overflow-hidden border-y py-3 sm:block">
              <div className="landing-marquee flex w-max gap-3">
                {[...proofItems, ...proofItems].map((item, index) => (
                  <Badge key={`${item}-${index}`} variant="secondary">
                    <CheckCircle2Icon data-icon="inline-start" />
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <LandingProductMotion />
        </div>
      </section>

      <section id="platform" className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-16 md:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <h2 className="text-4xl font-semibold tracking-normal text-balance">The payment layer stays outside your app</h2>
          <p className="text-base leading-7 text-muted-foreground">
            Merchant products keep their catalog and fulfillment logic. Mermer Pay owns the payment rail, hosted
            checkout, settlement privacy, and callback truth.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {platformPillars.map((pillar) => {
            const Icon = pillar.icon

            return (
              <Card className="landing-card-hover" key={pillar.title}>
                <CardHeader>
                  <Badge className="w-fit" variant="secondary">
                    <Icon data-icon="inline-start" />
                    {pillar.title}
                  </Badge>
                  <CardTitle className="text-base">{pillar.title}</CardTitle>
                  <CardDescription>{pillar.description}</CardDescription>
                </CardHeader>
              </Card>
            )
          })}
        </div>
      </section>

      <section id="workflow" className="border-y bg-muted/30">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-16 md:px-8">
          <div className="flex max-w-3xl flex-col gap-3">
            <h2 className="text-4xl font-semibold tracking-normal text-balance">A checkout operation loop you can see</h2>
            <p className="text-base leading-7 text-muted-foreground">
              Configure a project, send the buyer through hosted checkout, wait for finality, then release fulfillment
              from the merchant backend.
            </p>
          </div>
          <div className="landing-film overflow-hidden">
            <div className="landing-film-track flex w-max gap-4">
              {[...operationFrames, ...operationFrames].map((frame, index) => {
                const Icon = frame.icon

                return (
                  <article className="w-[18rem] shrink-0 rounded-lg border bg-background p-4 shadow-sm md:w-[23rem]" key={`${frame.title}-${index}`}>
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">
                        <Icon data-icon="inline-start" />
                        {frame.action}
                      </Badge>
                      <span className="text-xs font-medium text-muted-foreground">{frame.metric}</span>
                    </div>
                    <div className="mt-6 rounded-lg border bg-muted/40 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <BlocksIcon />
                        {frame.title}
                      </div>
                      <Separator className="my-3" />
                      <div className="grid gap-2">
                        <div className="h-2 rounded-full bg-foreground/20" />
                        <div className="h-2 w-4/5 rounded-full bg-foreground/12" />
                        <div className="h-2 w-3/5 rounded-full bg-foreground/12" />
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-muted-foreground">{frame.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="developers" className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-16 md:px-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-4">
          <h2 className="text-4xl font-semibold tracking-normal text-balance">A developer boundary that stays clean</h2>
          <p className="text-base leading-7 text-muted-foreground">
            Merchant products integrate through a compact backend contract. Mermer Pay keeps checkout, private
            settlement, and webhook truth outside the product codebase.
          </p>
          <ButtonGroup className="w-fit flex-wrap">
            {isAuthenticated ? (
              <Button nativeButton={false} render={<Link href={opsHref} />} size="lg" variant="outline">
                View ops
              </Button>
            ) : null}
          </ButtonGroup>
        </div>

        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              <BracesIcon data-icon="inline-start" />
              integration contract
            </Badge>
            <CardTitle>Merchant project handoff</CardTitle>
            <CardDescription>One direction of dependency: merchant product to Mermer Pay, never the reverse.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-0 overflow-hidden rounded-lg border">
              {boundaryRows.map(([label, value], index) => (
                <div className="grid gap-2 p-4 md:grid-cols-[11rem_1fr]" key={label}>
                  <div className="font-medium">{label}</div>
                  <div className="text-muted-foreground">{value}</div>
                  {index < boundaryRows.length - 1 ? <Separator className="md:col-span-2" /> : null}
                </div>
              ))}
            </div>
            <pre className="mt-4 max-w-full overflow-x-auto rounded-lg border bg-muted p-4 text-xs leading-6 text-muted-foreground">
              <code>{`POST /api/orders/checkout
-> merchant backend
-> Mermer Pay /api/projects/{projectId}/checkout-sessions
-> hosted checkout URL
-> webhook release event`}</code>
            </pre>
          </CardContent>
        </Card>
      </section>

      <section className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-5 px-4 py-10 md:flex-row md:items-center md:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal">Start from the payment project.</h2>
            <p className="mt-2 text-muted-foreground">Create a project, open hosted checkout, and wire a production webhook endpoint.</p>
          </div>
          <Button nativeButton={false} render={<Link href={consoleHref} />} size="lg">
            {isAuthenticated ? "Open merchant console" : "Log in"}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </section>

      <PublicFooter isAuthenticated={isAuthenticated} />
    </main>
  )
}
