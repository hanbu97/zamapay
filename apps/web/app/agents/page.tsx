import Link from "next/link"
import { cookies } from "next/headers"
import { ArrowRightIcon, BotIcon, FileJsonIcon, TerminalIcon } from "lucide-react"

import { buildInstallSurface } from "@/app/docs/docs-content"
import { PublicFooter } from "@/components/marketing/PublicFooter"
import { PublicHeader } from "@/components/marketing/PublicHeader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getOptionalSession } from "@/lib/api"

const install = buildInstallSurface("https://zamapay.org")

const agentEntries = [
  {
    description: "Install the Codex skill from the well-known endpoint into the local skills directory.",
    href: install.skillInstallUrl,
    icon: BotIcon,
    title: "Agent skill installer",
  },
  {
    description: "Install the CLI from source today, then switch to prebuilt release mode when publishing starts.",
    href: install.cliInstallUrl,
    icon: TerminalIcon,
    title: "CLI installer",
  },
  {
    description: "Machine-readable docs, rules, package names, and install URLs for coding agents.",
    href: "/.well-known/zamapay.json",
    icon: FileJsonIcon,
    title: "Integration manifest",
  },
]

export const metadata = {
  description: "Agent and CLI integration entrypoints for ZamaPay merchant implementations.",
  title: "Agents - ZamaPay",
}

export default async function AgentsPage() {
  const session = await getOptionalSession((await cookies()).toString())
  const isAuthenticated = Boolean(session.authenticated && session.user)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicHeader isAuthenticated={isAuthenticated} />

      <section className="login-product-bg border-b">
        <div className="mx-auto grid min-h-[26rem] w-full max-w-7xl items-center gap-10 px-4 py-16 md:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(22rem,0.5fr)]">
          <div className="grid max-w-3xl gap-5">
            <Badge className="w-fit" variant="secondary">
              <BotIcon data-icon="inline-start" />
              Agent entry
            </Badge>
            <h1 className="text-4xl font-semibold leading-tight tracking-normal md:text-6xl">
              Give agents the same contract as your docs
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              ZamaPay exposes stable install scripts, a Codex skill, llms files, and a well-known integration manifest so
              merchant implementation agents can configure projects without guessing payment boundaries.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button nativeButton={false} render={<Link href="/docs/install" />}>
                Install guide
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
              <Button nativeButton={false} render={<Link href="/llms.txt" />} variant="outline">
                llms.txt
              </Button>
            </div>
          </div>

          <div className="rounded-lg border bg-background/70 p-4 shadow-sm">
            <div className="text-sm font-semibold">One-command setup</div>
            <pre className="mt-3 overflow-x-auto rounded-md border bg-muted/45 p-3 text-xs leading-6">
              <code>{`bash <(curl -fsSL https://zamapay.org/install.sh) --from-source /path/to/zamapay --agents --yes`}</code>
            </pre>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Prebuilt CLI release mode is reserved at the same URL. Source mode keeps the current preview honest.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-14 md:px-8 md:grid-cols-3">
        {agentEntries.map((entry) => {
          const Icon = entry.icon

          return (
            <Card className="min-h-full" key={entry.title}>
              <CardHeader>
                <Badge className="w-fit" variant="secondary">
                  <Icon data-icon="inline-start" />
                  Entrypoint
                </Badge>
                <CardTitle>{entry.title}</CardTitle>
                <CardDescription>{entry.description}</CardDescription>
                <Button className="mt-2 w-fit" nativeButton={false} render={<Link href={entry.href} />} variant="outline">
                  Open
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </CardHeader>
            </Card>
          )
        })}
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-16 md:px-8 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">Agent rules</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            These rules are duplicated in `llms.txt`, the manifest, and the skill because they are integration
            invariants, not optional prose.
          </p>
        </div>
        <div className="grid gap-2 text-sm leading-6 text-muted-foreground">
          <p>Keep merchant secrets server-side. Never put `ZAMAPAY_SECRET_KEY` or `whsec_...` in browser code.</p>
          <p>Every checkout creation must choose `zama_private` or `evm_erc20` explicitly.</p>
          <p>Webhook receivers must verify Svix-style headers against raw bytes before parsing JSON.</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-16 md:px-8">
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-xl font-semibold tracking-normal">Package names</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            The server SDK package is the first merchant runtime package. The CLI npm wrapper is reserved for release
            automation and should point to the same command shape as the source installer.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <pre className="overflow-x-auto rounded-md border bg-muted/45 p-3 text-xs leading-6">
              <code>{`npm install @zamapay/server`}</code>
            </pre>
            <pre className="overflow-x-auto rounded-md border bg-muted/45 p-3 text-xs leading-6">
              <code>{`npm install -g @zamapay/cli`}</code>
            </pre>
          </div>
        </div>
      </section>

      <PublicFooter isAuthenticated={isAuthenticated} />
    </main>
  )
}
