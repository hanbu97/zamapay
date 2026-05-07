import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { cn } from '@/lib/utils'
import './globals.css'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Mermer Pay',
  description: 'Confidential merchant checkout powered by Zama FHEVM.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn('bg-background font-sans', geist.variable)}>
      <body>{children}</body>
    </html>
  )
}
