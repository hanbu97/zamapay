'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowUpRightIcon, HomeIcon, NetworkIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

const pageNames: Record<string, string> = {
  '/merchant': 'Payment projects',
  '/dashboard': 'Payments',
  '/login': 'Wallet login',
  '/ops': 'Diagnostics',
}

type TopBarProps = {
  isAuthenticated: boolean
}

export function TopBar({ isAuthenticated }: TopBarProps) {
  const pathname = usePathname()
  const pageName = currentPageName(pathname)
  const loginHref = pathname === '/login' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" />
      <Separator className="h-4" orientation="vertical" />

      <Button className="min-w-0 shrink-0" nativeButton={false} render={<Link href="/" />} size="sm" variant="ghost">
        <HomeIcon data-icon="inline-start" />
        <span className="hidden sm:inline">Mermer Pay</span>
        <span className="sm:hidden">Home</span>
      </Button>
      <Separator className="hidden h-4 sm:block" orientation="vertical" />

      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="min-w-0 flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="block max-w-[7.5rem] truncate sm:max-w-none">{pageName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {isAuthenticated ? (
        <ButtonGroup className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              <NetworkIcon data-icon="inline-start" />
              Console
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Runtime surface</DropdownMenuLabel>
                <DropdownMenuItem>
                  <ShieldCheckIcon />
                  Zama FHEVM rail
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <ArrowUpRightIcon />
                  Finality-gated fulfillment
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Quick links</DropdownMenuLabel>
                <DropdownMenuItem render={<Link href="/merchant" />}>Projects</DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/dashboard" />}>Payments</DropdownMenuItem>
                <DropdownMenuItem render={<Link href="/ops" />}>Diagnostics</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button nativeButton={false} render={<Link href="/dashboard" />} size="sm">
            Dashboard
          </Button>
        </ButtonGroup>
      ) : (
        <Button className="shrink-0" nativeButton={false} render={<Link href={loginHref} />} size="sm">
          Log in
        </Button>
      )}
    </header>
  )
}

function currentPageName(pathname: string): string {
  if (pathname.startsWith('/checkout/')) {
    return 'Hosted checkout'
  }

  return pageNames[pathname] ?? 'Merchant console'
}
