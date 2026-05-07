import Link from "next/link"
import { cookies } from "next/headers"
import {
  ArrowRightIcon,
  BookOpenIcon,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { Separator } from "@/components/ui/separator"
import { getOptionalSession } from "@/lib/api"
import { docsPages } from "./docs/docs-content"

const proofItems = ["Hosted checkout", "Wallet login", "Encrypted settlement", "Finality gate", "Webhook release"]

const docsMenuItems = [
  {
    description: "Start with the full Mermer Pay integration map.",
    href: "/docs",
    icon: BookOpenIcon,
    title: "Docs home",
  },
  ...docsPages.map((page) => ({
    description: page.description,
    href: `/docs/${page.slug}`,
    icon: page.icon,
    title: page.title,
  })),
]

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

const productLinks = [
  { href: "#platform", label: "Platform" },
  { href: "#workflow", label: "Workflow" },
  { href: "#developers", label: "Developers" },
]

const resourceLinks = [
  { href: "/docs", label: "Docs home" },
  { href: "/docs/quickstart", label: "Quickstart" },
  { href: "/docs/api-reference", label: "API reference" },
  { href: "/docs/webhooks", label: "Webhooks" },
]

const zamaLinks = [
  { href: "https://www.zama.org/", label: "Zama" },
  { href: "https://docs.zama.org/", label: "Zama docs" },
  { href: "https://docs.zama.org/protocol/protocol/overview", label: "Zama Protocol" },
]

const socialPlaceholders = [
  {
    color: "#111111",
    hideLabel: true,
    label: "X",
    path: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
  },
  {
    color: "#181717",
    label: "GitHub",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
  {
    color: "#5865F2",
    label: "Discord",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
  {
    color: "#26A5E4",
    label: "Telegram",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
]

export default async function SiteHomePage() {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)
  const consoleHref = isAuthenticated ? "/merchant" : "/login?next=/merchant"
  const dashboardHref = isAuthenticated ? "/dashboard" : "/login?next=/dashboard"
  const opsHref = isAuthenticated ? "/ops" : "/login?next=/ops"
  const workspaceLinks = isAuthenticated
    ? [
        { href: "/merchant", label: "Merchant console" },
        { href: dashboardHref, label: "Dashboard" },
        { href: opsHref, label: "Ops diagnostics" },
      ]
    : [{ href: "/login?next=/merchant", label: "Log in" }]

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/78">
        <div className="mx-auto grid h-14 w-full max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 md:px-8">
          <Link className="flex min-w-0 items-center gap-2 justify-self-start font-semibold" href="/">
            <span className="grid size-8 place-items-center rounded-md border bg-muted text-xs">MP</span>
            <span className="truncate">Mermer Pay</span>
          </Link>
          <NavigationMenu className="flex">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger className="h-9 gap-1.5 rounded-full px-3 text-sm">
                  <BookOpenIcon className="size-4" />
                  Docs
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <div className="grid w-[440px] max-w-[calc(100vw-2rem)] gap-0.5 p-2.5">
                    {docsMenuItems.map((item) => {
                      const Icon = item.icon

                      return (
                        <NavigationMenuLink
                          className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 rounded-lg p-2 hover:bg-muted/70"
                          key={item.href}
                          render={<Link href={item.href} />}
                        >
                          <span className="grid size-9 place-items-center rounded-lg border bg-background text-foreground shadow-sm [&_svg]:size-4">
                            <Icon />
                          </span>
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-semibold leading-tight">{item.title}</span>
                            <span className="line-clamp-1 text-xs leading-4 text-muted-foreground">{item.description}</span>
                          </span>
                        </NavigationMenuLink>
                      )
                    })}
                  </div>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <Button className="justify-self-end" nativeButton={false} render={<Link href={dashboardHref} />} size="sm">
            {isAuthenticated ? "Dashboard" : "Log in"}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </header>

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

      <footer className="border-t bg-muted/25">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 md:grid-cols-2 md:px-8 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
          <div className="flex max-w-sm flex-col gap-4">
            <Link className="flex w-fit items-center gap-2 font-semibold" href="/">
              <span className="grid size-8 place-items-center rounded-md border bg-background text-xs">MP</span>
              <span>Mermer Pay</span>
            </Link>
            <p className="text-sm leading-6 text-muted-foreground">
              Hosted crypto checkout for merchant products, with private settlement on the Zama rail and finality-safe
              webhook release.
            </p>
            <div className="flex flex-wrap gap-2">
              {socialPlaceholders.map((account) => (
                <span
                  aria-disabled="true"
                  className="inline-flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground"
                  key={account.label}
                >
                  <svg
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    fill="currentColor"
                    style={{ color: account.color }}
                    viewBox="0 0 24 24"
                  >
                    <path d={account.path} />
                  </svg>
                  <span className={account.hideLabel ? "sr-only" : undefined}>{account.label}</span>
                  <span className="text-xs">soon</span>
                </span>
              ))}
            </div>
          </div>

          <FooterLinkGroup links={productLinks} title="Product" />
          <FooterLinkGroup links={resourceLinks} title="Resources" />
          <FooterLinkGroup links={workspaceLinks} title="Workspace" />
          <FooterLinkGroup external links={zamaLinks} title="Zama" />
        </div>

        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 border-t px-4 py-5 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
          <span>© {new Date().getFullYear()} Mermer Pay. Built for confidential merchant settlement.</span>
          <div className="flex flex-wrap gap-4">
            <Link className="hover:text-foreground" href="/docs/environments">
              Environments
            </Link>
            <Link className="hover:text-foreground" href="/docs/cardforge">
              Demo template
            </Link>
            <Link className="hover:text-foreground" href="/docs/webhooks">
              Webhook guide
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}

function FooterLinkGroup({
  external = false,
  links,
  title,
}: {
  external?: boolean
  links: { href: string; label: string }[]
  title: string
}) {
  return (
    <nav aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-normal">{title}</h2>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        {links.map((link) =>
          external ? (
            <a className="w-fit hover:text-foreground" href={link.href} key={link.href} rel="noreferrer" target="_blank">
              {link.label}
            </a>
          ) : (
            <Link className="w-fit hover:text-foreground" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  )
}
