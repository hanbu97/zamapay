import * as React from 'react'
import { cn } from '@/lib/utils'

function Separator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('h-px w-full bg-border', className)} data-slot="separator" role="separator" {...props} />
}

export { Separator }
