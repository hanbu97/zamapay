import * as React from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col rounded-lg border bg-card text-card-foreground shadow-xs', className)}
      data-slot="card"
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1.5 px-5 pt-5', className)}
      data-slot="card-header"
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-semibold leading-none', className)} data-slot="card-title" {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('text-sm text-muted-foreground', className)} data-slot="card-description" {...props} />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 py-5', className)} data-slot="card-content" {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center px-5 pb-5', className)} data-slot="card-footer" {...props} />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />
  )
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
