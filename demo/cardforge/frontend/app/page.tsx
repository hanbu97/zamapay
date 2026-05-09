import { ArrowUpRightIcon, HomeIcon } from 'lucide-react'
import { ConfidentialWalletPanel } from '@/components/cardforge/ConfidentialWalletPanel'
import { ProductCoverflow } from '@/components/cardforge/ProductCoverflow'
import { buttonVariants } from '@/components/ui/button'
import { cardForgeConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

export default function CardForgePage() {
  const config = cardForgeConfig()

  return (
    <div className="min-h-screen bg-[#08080a] text-foreground xl:[--wallet-rail:clamp(340px,25vw,400px)]">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#08080a]/90 backdrop-blur supports-[backdrop-filter]:bg-[#08080a]/80 xl:mr-[var(--wallet-rail)]">
        <div className="flex h-14 w-full items-center justify-between gap-3 px-4 md:px-8">
          <a
            className={cn(
              buttonVariants({ variant: 'secondary', size: 'sm' }),
              'min-w-0 justify-start !border !border-white/10 !bg-white/[0.08] !text-white hover:!bg-white/[0.14]',
            )}
            href="/"
          >
            <HomeIcon data-icon="inline-start" />
            <span className="truncate">CardForge</span>
          </a>
          <a
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'shrink-0 !border-white/15 !bg-white/[0.04] !text-white/90 hover:!bg-white/[0.1] hover:!text-white',
            )}
            href={config.mermerConsoleUrl}
          >
            <span className="hidden sm:inline">Mermer Pay</span>
            <span className="sm:hidden">Pay</span>
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </div>
      </header>

      <main className="min-h-[calc(100vh-3.5rem)] bg-[linear-gradient(180deg,#101014_0%,#08080a_72%)] px-4 py-5 md:px-8 md:py-8 xl:mr-[var(--wallet-rail)]">
        <div className="w-full min-w-0">
          <ProductCoverflow />
        </div>
      </main>

      <aside className="px-4 pb-6 md:px-8 xl:fixed xl:right-0 xl:top-0 xl:z-30 xl:flex xl:h-screen xl:w-[var(--wallet-rail)] xl:flex-col xl:overflow-y-auto xl:border-l xl:border-white/10 xl:bg-[#111114] xl:px-4 xl:py-6">
        <ConfidentialWalletPanel
          className="xl:h-full xl:rounded-none xl:border-0 xl:bg-transparent xl:shadow-none"
        />
      </aside>
    </div>
  )
}
