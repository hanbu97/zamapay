'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LogOutIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { logoutSession, type BillingPlan } from '@/lib/api'
import { cn } from '@/lib/utils'

type BreadcrumbCrumb = {
  href?: string
  label: string
}

type SearchParamsSnapshot = Pick<URLSearchParams, 'get' | 'toString'>

const projectTabLabels: Record<string, string> = {
  integration: 'Integration',
  payments: 'Payments',
  webhooks: 'Webhooks',
}

type PlanDisplay = {
  label: string
  variant: 'default' | 'outline' | 'secondary'
}

const planDisplays: Record<BillingPlan, PlanDisplay> = {
  enterprise: {
    label: 'Enterprise',
    variant: 'outline',
  },
  free: {
    label: 'Free tier',
    variant: 'secondary',
  },
  growth: {
    label: 'Growth',
    variant: 'default',
  },
}

const staticBreadcrumbs: Record<string, BreadcrumbCrumb[]> = {
  '/billing': [
    {
      href: '/dashboard',
      label: 'Account',
    },
    {
      label: 'Billing',
    },
  ],
  '/billing/upgrade': [
    {
      href: '/dashboard',
      label: 'Account',
    },
    {
      href: '/billing',
      label: 'Billing',
    },
    {
      label: 'Upgrade',
    },
  ],
  '/dashboard': [
    {
      label: 'Account',
    },
    {
      label: 'Overview',
    },
  ],
  '/login': [
    {
      label: 'Access',
    },
    {
      label: 'Wallet login',
    },
  ],
  '/merchant': [
    {
      href: '/dashboard',
      label: 'Account',
    },
    {
      label: 'Projects',
    },
  ],
}

type TopBarProps = {
  isAuthenticated: boolean
  subscriptionPlan?: BillingPlan | null
  userAddress?: string | null
}

export function TopBar({ isAuthenticated, subscriptionPlan, userAddress }: TopBarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const crumbs = currentBreadcrumb(pathname, searchParams)
  const currentHref = currentPath(pathname, searchParams)
  const loginHref = pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(currentHref)}`

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" />

      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="min-w-0 flex-nowrap gap-1">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1

            return (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem className="min-w-0">
                  {crumb.href && !isLast ? (
                    <BreadcrumbLink className="block max-w-[8rem] truncate sm:max-w-none" render={<Link href={crumb.href} />}>
                      {crumb.label}
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="block max-w-[8rem] truncate sm:max-w-none">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      {isAuthenticated ? (
        <AccountProfile subscriptionPlan={subscriptionPlan} userAddress={userAddress} />
      ) : (
        <Button className="shrink-0" nativeButton={false} render={<Link href={loginHref} />} size="sm">
          Log in
        </Button>
      )}
    </header>
  )
}

function AccountProfile({
  subscriptionPlan,
  userAddress,
}: {
  subscriptionPlan?: BillingPlan | null
  userAddress?: string | null
}) {
  const planDisplay = subscriptionPlan ? planDisplays[subscriptionPlan] : null
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  async function handleLogout() {
    setIsLoggingOut(true)

    try {
      await logoutSession()
      router.replace('/login')
      router.refresh()
    } catch (caught) {
      console.error(caught)
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      {planDisplay ? (
        <Badge
          aria-label={`${planDisplay.label} billing upgrade`}
          render={<Link href="/billing/upgrade" />}
          variant={planDisplay.variant}
        >
          {planDisplay.label}
        </Badge>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open account menu"
          className={cn(buttonVariants({ size: 'icon-lg', variant: 'ghost' }), 'rounded-full p-0')}
        >
          <Avatar>
            <AvatarFallback>{walletInitials(userAddress)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem disabled={isLoggingOut} onClick={() => void handleLogout()} variant="destructive">
            <LogOutIcon />
            {isLoggingOut ? 'Logging out...' : 'Log out'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function currentBreadcrumb(pathname: string, searchParams: SearchParamsSnapshot): BreadcrumbCrumb[] {
  if (pathname.startsWith('/checkout/')) {
    return [
      {
        label: 'Checkout',
      },
      {
        label: 'Hosted checkout',
      },
    ]
  }

  if (pathname.startsWith('/merchant/')) {
    const tab = searchParams.get('tab')

    return [
      {
        href: '/merchant',
        label: 'Projects',
      },
      {
        label: 'Project',
      },
      {
        label: tab ? (projectTabLabels[tab] ?? 'Overview') : 'Overview',
      },
    ]
  }

  return staticBreadcrumbs[pathname] ?? [
    {
      label: 'Console',
    },
  ]
}

function currentPath(pathname: string, searchParams: SearchParamsSnapshot) {
  const query = searchParams.toString()

  return query ? `${pathname}?${query}` : pathname
}

function walletInitials(address: string | null | undefined) {
  const normalized = address?.replace(/^0x/i, '').trim()

  return normalized ? normalized.slice(0, 2).toUpperCase() : 'MP'
}
