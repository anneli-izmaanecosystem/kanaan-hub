'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { LayoutDashboard, CalendarDays, DollarSign, MessageSquare, Fuel, Users, Tag, AlertTriangle, Receipt, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const COLLAPSED_KEY = 'sidebar-collapsed'

const nav = [
  { href: '/dashboard',           label: 'Overview',     icon: LayoutDashboard, exact: true },
  { href: '/dashboard/bookings',  label: 'Bookings',     icon: CalendarDays },
  { href: '/dashboard/actions',   label: 'Actions',      icon: AlertTriangle },
  { href: '/dashboard/pricelist', label: 'Pricelist',    icon: Tag },
  { href: '/dashboard/payroll',   label: 'Payroll',      icon: DollarSign },
  { href: '/dashboard/staff',    label: 'Staff',        icon: Users },
  { href: '/dashboard/fuel',     label: 'Fuel Log',     icon: Fuel },
  { href: '/dashboard/invoices-inbox', label: 'Invoices Inbox', icon: Receipt },
  { href: '/dashboard/ai',       label: 'AI Assistant', icon: MessageSquare },
]

export function Sidebar() {
  const pathname = usePathname()
  // Defaults expanded on first render (matches the pre-collapse layout) and only
  // flips after mount, once we know what was actually saved — avoids a flash of
  // the wrong width before localStorage is read.
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true)
  }, [])

  function toggle() {
    setCollapsed(v => {
      const next = !v
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <aside className={cn('flex h-full flex-col border-r border-gray-200 bg-white transition-[width] duration-150', collapsed ? 'w-14' : 'w-56')}>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-gray-100', collapsed ? 'justify-center px-2' : 'px-6')}>
        {!collapsed && (
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-gray-900">Kanaan Hub</p>
            <p className="text-[11px] text-gray-400">Guest Farm Management</p>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                active ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              <Icon size={16} />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      <button
        onClick={toggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex items-center gap-2 border-t border-gray-100 py-3 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-colors',
          collapsed ? 'justify-center px-0' : 'px-5',
        )}
      >
        {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
      </button>

      <div className={cn('flex items-center gap-3 border-t border-gray-100 py-4', collapsed ? 'justify-center px-2' : 'px-5')}>
        <UserButton />
        {!collapsed && <span className="text-xs text-gray-500">Account</span>}
      </div>
    </aside>
  )
}
