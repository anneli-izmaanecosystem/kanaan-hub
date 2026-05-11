import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'Kanaan Hub',
  description: 'Kanaan Guest Farm — Bookings, Payroll & AI Assistant',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY}>
      <html lang="en" className={`${geist.variable} h-full antialiased`}>
        <body className="h-full">{children}</body>
      </html>
    </ClerkProvider>
  )
}
