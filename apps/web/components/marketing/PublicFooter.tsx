import Link from "next/link"

import brandLogo from "../../../../assets/logo.svg"

const productLinks = [
  { href: "/#platform", label: "Platform" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#developers", label: "Developers" },
]

const resourceLinks = [
  { href: "/docs", label: "Docs home" },
  { href: "/agents", label: "Agents" },
  { href: "/docs/quickstart", label: "Quickstart" },
  { href: "/docs/install", label: "Install" },
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

type PublicFooterProps = {
  isAuthenticated: boolean
}

export function PublicFooter({ isAuthenticated }: PublicFooterProps) {
  const workspaceLinks = isAuthenticated
    ? [
        { href: "/merchant", label: "Merchant console" },
        { href: "/dashboard", label: "Dashboard" },
      ]
    : [{ href: "/login?next=/merchant", label: "Log in" }]

  return (
    <footer className="border-t bg-muted/25">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 md:grid-cols-2 md:px-8 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
        <div className="flex max-w-sm flex-col gap-4">
          <Link className="flex w-fit items-center gap-2 font-semibold" href="/">
            <img alt="" aria-hidden="true" className="size-8 shrink-0 rounded-md border object-cover" src={brandLogo.src} />
            <span>ZamaPay</span>
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
        <span>© {new Date().getFullYear()} ZamaPay. Built for confidential merchant settlement.</span>
        <div className="flex flex-wrap gap-4">
          <Link className="hover:text-foreground" href="/docs/environments">
            Environments
          </Link>
          <Link className="hover:text-foreground" href="/pricing">
            Pricing
          </Link>
          <Link className="hover:text-foreground" href="/docs/webhooks">
            Webhook guide
          </Link>
        </div>
      </div>
    </footer>
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
