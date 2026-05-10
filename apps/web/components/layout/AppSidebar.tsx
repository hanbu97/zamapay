'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftIcon,
  Building2Icon,
  BellRingIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogInIcon,
  ReceiptTextIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

type NavItem = {
  activeTab?: string
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
    label: 'Account',
    items: [
      {
        href: '/dashboard',
        icon: LayoutDashboardIcon,
        title: 'Overview',
      },
      {
        href: '/merchant',
        icon: Building2Icon,
        title: 'Projects',
      },
      {
        href: '/billing',
        icon: ReceiptTextIcon,
        title: 'Billing',
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
  const searchParams = useSearchParams()
  const projectId = currentProjectId(pathname)
  const navSections = isAuthenticated
    ? projectId
      ? projectNavSections(projectId)
      : authenticatedNavSections
    : anonymousNavSections

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />} size="lg" tooltip="Back to home">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg font-semibold">MP</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Mermer Pay</span>
                <span className="truncate text-xs text-muted-foreground">Back to home</span>
              </span>
            </SidebarMenuButton>
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
                        isActive={isActivePath(pathname, item, searchParams)}
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

      <SidebarRail />
    </Sidebar>
  )
}

function projectNavSections(projectId: string): NavSection[] {
  const baseHref = `/merchant/${projectId}`

  return [
    {
      label: 'Project',
      items: [
        {
          href: '/merchant',
          icon: ArrowLeftIcon,
          title: 'All projects',
        },
        {
          href: baseHref,
          icon: LayoutDashboardIcon,
          title: 'Overview',
        },
        {
          activeTab: 'integration',
          href: `${baseHref}?tab=integration`,
          icon: KeyRoundIcon,
          title: 'Integration',
        },
        {
          activeTab: 'webhooks',
          href: `${baseHref}?tab=webhooks`,
          icon: BellRingIcon,
          title: 'Webhooks',
        },
        {
          activeTab: 'payments',
          href: `${baseHref}?tab=payments`,
          icon: ReceiptTextIcon,
          title: 'Payments',
        },
      ],
    },
  ]
}

function currentProjectId(pathname: string) {
  const match = /^\/merchant\/([^/?#]+)/.exec(pathname)

  return match ? decodeURIComponent(match[1]) : null
}

function isActivePath(pathname: string, item: NavItem, searchParams: URLSearchParams): boolean {
  const hrefPath = item.href.split(/[?#]/)[0]

  if (item.href.includes('#')) {
    return false
  }

  if (hrefPath.startsWith('/checkout/')) {
    return pathname.startsWith('/checkout/')
  }

  if (item.activeTab) {
    return pathname === hrefPath && searchParams.get('tab') === item.activeTab
  }

  if (pathname !== hrefPath) {
    return pathname.startsWith(`${hrefPath}/`) && hrefPath !== '/merchant'
  }

  const tab = searchParams.get('tab')
  return !tab || isDeprecatedProjectTab(tab) || item.href.includes('#')
}

function isDeprecatedProjectTab(tab: string) {
  return tab === 'diagnostics' || tab === 'withdraw'
}
