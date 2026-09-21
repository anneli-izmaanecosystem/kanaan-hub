'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Car } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/dashboard/transfers',              label: 'Dispatch',      exact: true },
  { href: '/dashboard/transfers/drivers',      label: 'Drivers' },
  { href: '/dashboard/transfers/destinations', label: 'Destinations' },
  { href: '/dashboard/transfers/settings',     label: 'Rates & rules' },
]

export default function TransfersLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-5">
        <Car size={20} className="text-gray-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Transportation</h1>
        <span className="text-sm text-gray-400">Cars booked over WhatsApp</span>
      </div>

      <nav className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map(t => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800',
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
