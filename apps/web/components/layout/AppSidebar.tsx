'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  Building2Icon,
  ChevronsUpDownIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LockKeyholeIcon,
  LogInIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'

type NavItem = {
  badge?: string
  href: string
  icon: LucideIcon
  title: string
}

type NavSection = {
  items: NavItem[]
  label: string
}

const authenticatedNavSections: NavSection[] = [
  {
    label: 'Payment platform',
    items: [
      {
        href: '/merchant',
        icon: Building2Icon,
        title: 'Projects',
      },
      {
        badge: 'Live',
        href: '/dashboard',
        icon: LayoutDashboardIcon,
        title: 'Payments',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/ops',
        icon: GaugeIcon,
        title: 'Diagnostics',
      },
      {
        href: '/login',
        icon: LogInIcon,
        title: 'Wallet login',
      },
    ],
  },
]

const anonymousNavSections: NavSection[] = [
  {
    label: 'Access',
    items: [
      {
        href: '/login',
        icon: LogInIcon,
        title: 'Log in',
      },
    ],
  },
]

type AppSidebarProps = {
  isAuthenticated: boolean
}

export function AppSidebar({ isAuthenticated }: AppSidebarProps) {
  const pathname = usePathname()
  const navSections = isAuthenticated ? authenticatedNavSections : anonymousNavSections

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                    size="lg"
                  />
                }
              >
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg font-semibold">MP</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Mermer Pay</span>
                  <span className="truncate text-xs text-muted-foreground">Payment workspace</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--anchor-width)">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                  <DropdownMenuItem>
                    <ShieldCheckIcon />
                    Zama Sepolia rail
                    <Badge className="ml-auto" variant="secondary">
                      active
                    </Badge>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Mode</DropdownMenuLabel>
                  <DropdownMenuItem>
                    <LockKeyholeIcon />
                    Confidential settlement
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActivePath(pathname, item.href)}
                        render={<Link href={item.href} />}
                        tooltip={item.title}
                      >
                        <Icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href={isAuthenticated ? '/dashboard' : '/login'} />}
              tooltip={isAuthenticated ? 'Payments dashboard' : 'Log in'}
            >
              {isAuthenticated ? <LayoutDashboardIcon /> : <WalletCardsIcon />}
              <span>{isAuthenticated ? 'Payments dashboard' : 'Log in'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function isActivePath(pathname: string, href: string): boolean {
  if (href.startsWith('/checkout/')) {
    return pathname.startsWith('/checkout/')
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}
