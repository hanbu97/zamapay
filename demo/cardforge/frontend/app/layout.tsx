import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CardForge Demo',
  description: 'Independent merchant demo configured to use ZamaPay hosted checkout.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
