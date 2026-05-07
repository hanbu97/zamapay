import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

type PageHeaderProps = {
  actions?: ReactNode
  badge?: string
  description: string
  title: string
}

export function PageHeader({ actions, badge, description, title }: PageHeaderProps) {
  return (
    <section className="flex flex-col gap-3 border-b pb-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            {badge ? (
              <Badge className="w-fit" variant="outline">
                {badge}
              </Badge>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  )
}
