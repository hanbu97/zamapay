import Link from "next/link"
import { cookies } from "next/headers"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  StoreIcon,
} from "lucide-react"

import { PublicFooter } from "@/components/marketing/PublicFooter"
import { PublicHeader } from "@/components/marketing/PublicHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getOptionalSession } from "@/lib/api"
import { contractEnvironmentConfig, publicContractEnvironment } from "@/lib/contract-environment"

const billingTerms = contractEnvironmentConfig(publicContractEnvironment()).manifest?.billing
const freeFee = formatFee("free")
const growthFee = formatFee("growth")
const enterpriseFee = formatFee("enterprise", "Custom")
const growthMonthlyPrice = formatPlanPrice("growth")

export const metadata = {
  description: "ZamaPay pricing for hosted crypto checkout, merchant billing workflows, and Zama confidential settlement.",
  title: "Pricing - ZamaPay",
}

const tiers = [
  {
    badge: "Free",
    description: "Start without a monthly fee.",
    fee: freeFee,
    features: ["No monthly fee", "Hosted checkout", "Project API key", "Signed webhooks"],
    name: "Free",
    price: "$0",
    support: "Self-serve",
  },
  {
    badge: "Recommended",
    description: "Lower rate for active merchants.",
    fee: growthFee,
    features: ["Lower checkout fee", "Billing workflows", "Webhook diagnostics", "Confidential add-on at +15 bps"],
    name: "Growth",
    price: growthMonthlyPrice,
    support: "Priority integration support",
  },
  {
    badge: "Scale",
    description: "Custom terms for volume and compliance.",
    fee: enterpriseFee,
    features: ["Volume pricing", "Dedicated settlement policy", "Confidential checkout package", "Custom compliance review"],
    name: "Enterprise",
    price: "Custom",
    support: "Private support channel",
  },
]

const feeRows = [
  {
    fee: `${freeFee} Free / ${growthFee} Growth`,
    note: "Free has no monthly fee; paid plans lower the rate.",
    product: "Hosted checkout / dynamic QR",
    settlement: "Instant balance; hourly withdrawal",
  },
  {
    fee: `${freeFee} Free / ${growthFee} Growth`,
    note: "Store volume can buy down the plan rate.",
    product: "Static QR / POS",
    settlement: "Instant receipt; daily settlement",
  },
  {
    fee: "0.55%",
    note: "Receivables, retries, and reconciliation.",
    product: "Invoice / B2B billing",
    settlement: "T+0/T+1 merchant balance",
  },
  {
    fee: "0.65%",
    note: "Renewals, grace periods, and dunning.",
    product: "Subscription billing",
    settlement: "Balance renewal with recovery",
  },
  {
    fee: "0.10% + gas",
    note: "Approval, retry, and audit trail.",
    product: "Batch payout / payroll",
    settlement: "Hourly or daily batches",
  },
  {
    fee: "Partner cost + 0.35%",
    note: "Card, bank, KYC, and fraud costs pass through.",
    product: "Fiat on/off-ramp",
    settlement: "Partner fiat timing",
  },
  {
    fee: "+15 bps",
    note: "Encrypted amount checks and selective disclosure.",
    product: "Confidential checkout",
    settlement: "Same rail; encrypted state",
  },
]

const policyItems = [
  "No fee on expired or unpaid checkouts.",
  "Gas, bridge, ramp, and bank fees pass through at cost.",
  "Confidential checkout is priced as a premium capability.",
]

function planTerms(plan: "free" | "growth" | "enterprise") {
  return billingTerms?.plans.find((terms) => terms.plan === plan)
}

function formatFee(plan: "free" | "growth" | "enterprise", fallback = "Contract required") {
  const feeBps = planTerms(plan)?.checkoutFeeBps
  if (feeBps === null || feeBps === undefined) {
    return fallback
  }

  return `${(feeBps / 100).toFixed(2)}%`
}

function formatPlanPrice(plan: "free" | "growth" | "enterprise") {
  const monthlyPrice = planTerms(plan)?.monthlyPriceMinorUnits
  if (monthlyPrice === null || monthlyPrice === undefined) {
    return "Custom"
  }

  return `$${(monthlyPrice / 1_000000).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

export default async function PricingPage() {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)
  const consoleHref = isAuthenticated ? "/merchant" : "/login?next=/merchant"

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <PublicHeader isAuthenticated={isAuthenticated} />

      <section className="landing-grid-bg border-b">
        <div className="mx-auto grid min-h-[52svh] w-full max-w-7xl items-center gap-8 px-4 py-10 md:px-8 lg:grid-cols-[0.88fr_1.12fr]">
          <div className="flex min-w-0 flex-col gap-5">
            <Badge className="w-fit" variant="secondary">
              <ShieldCheckIcon data-icon="inline-start" />
              Pricing strategy
            </Badge>
            <div className="flex flex-col gap-4">
              <h1 className="max-w-3xl text-4xl font-semibold leading-none tracking-normal text-balance md:text-6xl">
                Low-fee checkout. Premium confidential settlement.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
                Start free at {freeFee} per successful checkout. Upgrade to reduce the rate and unlock heavier billing,
                payout, and confidential settlement workflows.
              </p>
            </div>
            <ButtonGroup className="w-fit flex-wrap">
              <Button nativeButton={false} render={<Link href={consoleHref} />} size="lg">
                {isAuthenticated ? "Open console" : "Log in"}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button nativeButton={false} render={<a href="#fee-schedule" />} size="lg" variant="outline">
                View fee schedule
              </Button>
            </ButtonGroup>
          </div>

          <Card className="bg-background/92 shadow-sm">
            <CardHeader>
              <Badge className="w-fit" variant="outline">
                Free default
              </Badge>
              <CardTitle className="text-2xl">Start free with a {freeFee} take rate.</CardTitle>
              <CardDescription>
                No monthly fee until the merchant has volume. Paid plans buy down the checkout rate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Free checkout" value={freeFee} />
                <Metric label="Growth checkout" value={growthFee} />
                <Metric label="Confidential add-on" value="+15 bps" />
              </div>
              <div className="mt-4 grid gap-2">
                {policyItems.map((item) => (
                  <div className="flex items-start gap-2 text-sm leading-5 text-muted-foreground" key={item}>
                    <CheckCircle2Icon className="mt-0.5 shrink-0 text-foreground" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-16 md:px-8">
        <div className="flex max-w-3xl flex-col gap-3">
          <h2 className="text-4xl font-semibold tracking-normal text-balance">Plans for merchant maturity</h2>
          <p className="text-base leading-7 text-muted-foreground">
            Free starts the integration. Growth and Enterprise reduce fees as volume and workflow complexity increase.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {tiers.map((tier) => (
            <Card className="landing-card-hover" key={tier.name}>
              <CardHeader>
                <Badge className="w-fit" variant={tier.badge === "Recommended" ? "default" : "secondary"}>
                  {tier.badge}
                </Badge>
                <CardTitle className="flex items-baseline gap-2 text-2xl">
                  {tier.name}
                  <span className="text-sm font-normal text-muted-foreground">{tier.support}</span>
                </CardTitle>
                <CardDescription>{tier.description}</CardDescription>
                <CardAction>
                  <span className="text-sm font-medium text-muted-foreground">{tier.fee}</span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <div className="mb-5 flex items-end gap-1">
                  <span className="text-4xl font-semibold tracking-normal">{tier.price}</span>
                  {tier.price === "Custom" ? null : <span className="pb-1 text-sm text-muted-foreground">/ month</span>}
                </div>
                <div className="grid gap-2">
                  {tier.features.map((feature) => (
                    <div className="flex items-start gap-2 text-sm leading-6" key={feature}>
                      <CheckCircle2Icon className="mt-1 shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/30" id="fee-schedule">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-12 md:px-8">
          <div className="flex max-w-3xl flex-col gap-3">
            <Badge className="w-fit" variant="secondary">
              <StoreIcon data-icon="inline-start" />
              Workload pricing
            </Badge>
            <h2 className="text-3xl font-semibold tracking-normal text-balance md:text-4xl">Complete fee schedule</h2>
            <p className="text-sm leading-6 text-muted-foreground md:text-base">
              Checkout, billing, payouts, ramps, and privacy each carry a separate workload price.
            </p>
          </div>

          <div className="hidden w-full overflow-hidden rounded-xl border bg-background lg:block">
            <Table className="min-w-[1040px] table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[19%]" />
                <col className="w-[27%]" />
                <col className="w-[30%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 px-4 text-xs uppercase text-muted-foreground">Product</TableHead>
                  <TableHead className="h-9 px-4 text-xs uppercase text-muted-foreground">ZamaPay fee</TableHead>
                  <TableHead className="h-9 px-4 text-xs uppercase text-muted-foreground">Settlement</TableHead>
                  <TableHead className="h-9 px-4 text-xs uppercase text-muted-foreground">Policy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feeRows.map((row) => (
                  <TableRow className="h-12" key={row.product}>
                    <TableCell className="px-4 py-2 font-medium whitespace-normal leading-5">{row.product}</TableCell>
                    <TableCell className="px-4 py-2 whitespace-normal leading-5">{row.fee}</TableCell>
                    <TableCell className="px-4 py-2 whitespace-normal leading-5 text-muted-foreground">{row.settlement}</TableCell>
                    <TableCell className="px-4 py-2 whitespace-normal leading-5 text-muted-foreground">{row.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-2 lg:hidden">
            {feeRows.map((row) => (
              <Card size="sm" key={row.product}>
                <CardHeader className="gap-1">
                  <CardTitle className="text-base">{row.product}</CardTitle>
                  <CardAction>
                    <Badge variant="secondary">{row.fee}</Badge>
                  </CardAction>
                  <CardDescription className="leading-5">{row.settlement}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-5 text-muted-foreground">{row.note}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-5 px-4 py-10 md:flex-row md:items-center md:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-normal">Start free at {freeFee} per successful checkout.</h2>
            <p className="mt-2 text-muted-foreground">
              Upgrade when checkout volume, webhook operations, or confidential settlement justifies a lower rate.
            </p>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/35 p-3">
      <div className="text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs font-medium text-muted-foreground">{label}</div>
    </div>
  )
}
