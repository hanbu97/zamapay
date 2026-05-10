import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { BookOpenIcon, LockKeyholeIcon, RadioTowerIcon, ShieldCheckIcon } from 'lucide-react'
import { LoginCard } from '@/components/auth/LoginCard'
import { Separator } from '@/components/ui/separator'
import { getOptionalSession } from '@/lib/api'

type LoginPageProps = {
  searchParams?: Promise<{
    next?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const redirectTo = safeRedirectPath(params?.next)
  const session = await getOptionalSession((await cookies()).toString())

  if (session.authenticated && session.user) {
    redirect(redirectTo)
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-background pb-16 text-foreground lg:grid-cols-[minmax(520px,48vw)_1fr]">
      <section className="login-auth-bg flex min-h-[calc(100vh-4rem)] flex-col lg:order-2">
        <div className="flex flex-1 items-center justify-center px-6 py-10 lg:py-14">
          <div className="flex w-full max-w-[400px] flex-col items-center gap-8">
            <Link className="flex items-center gap-3" href="/">
              <span className="grid size-10 place-items-center rounded-xl border bg-card text-sm font-semibold shadow-sm">
                MP
              </span>
              <span className="text-2xl font-semibold tracking-normal">ZamaPay</span>
            </Link>
            <LoginCard redirectTo={redirectTo} />
            <Link className="text-sm font-medium underline underline-offset-4" href="/docs">
              Read integration docs
            </Link>
          </div>
        </div>
      </section>

      <section className="login-product-bg hidden min-h-[calc(100vh-4rem)] flex-col justify-center px-10 lg:order-1 lg:flex">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-10 text-center">
          <div className="flex flex-col items-center gap-5">
            <div className="grid size-12 place-items-center rounded-2xl border bg-card shadow-sm">
              <ShieldCheckIcon className="size-5" />
            </div>
            <div className="flex flex-col gap-4">
              <h1 className="text-3xl font-semibold tracking-normal">One private rail for merchant payments</h1>
              <p className="max-w-md text-base leading-7 text-muted-foreground">
                ZamaPay gives merchants a project API key, hosted checkout, signed webhooks, and Zama-backed
                settlement proof without exposing buyer payment details to the operator.
              </p>
            </div>
          </div>

          <Separator className="max-w-md" />

          <div className="flex w-full max-w-md flex-col gap-5">
            <p className="text-sm font-medium text-muted-foreground">Built for confidential payment operations</p>
            <div className="grid grid-cols-2 gap-3 text-left">
              <ProofItem icon={LockKeyholeIcon} title="Wallet session" description="Nonce signed merchant access" />
              <ProofItem icon={BookOpenIcon} title="Project API" description="Checkout creation boundary" />
              <ProofItem icon={RadioTowerIcon} title="Webhooks" description="Signed delivery attempts" />
              <ProofItem icon={ShieldCheckIcon} title="Zama FHEVM" description="Encrypted settlement checks" />
            </div>
          </div>
        </div>
      </section>
      <LoginFooter />
    </main>
  )
}

type ProofItemProps = {
  description: string
  icon: typeof ShieldCheckIcon
  title: string
}

function ProofItem({ description, icon: Icon, title }: ProofItemProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card/80 p-3 shadow-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-background">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </div>
  )
}

function LoginFooter() {
  return (
    <footer className="absolute inset-x-0 bottom-0 flex min-h-16 flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t bg-background/85 px-6 py-4 text-sm text-muted-foreground backdrop-blur">
      <Link href="/">zamapay.xyz</Link>
      <span>© 2026 ZamaPay Labs</span>
      <Link href="/docs">Docs</Link>
      <Link href="/docs/quickstart">Quickstart</Link>
    </footer>
  )
}

function safeRedirectPath(path: string | undefined): string {
  if (path?.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login')) {
    return path
  }

  return '/dashboard'
}
