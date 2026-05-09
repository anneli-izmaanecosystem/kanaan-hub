export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { bookings, payrollRuns, employees, rooms } from '@/lib/db/schema'
import { eq, gte, lte, and, count, sql } from 'drizzle-orm'
import { fmt } from '@/lib/utils'
import Link from 'next/link'
import { CalendarDays, Users, DollarSign, Home } from 'lucide-react'

export default async function DashboardPage() {
  const today = new Date().toISOString().split('T')[0]
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]

  const [
    activeRooms,
    activeEmployees,
    checkInsToday,
    upcomingBookings,
    draftRuns,
  ] = await Promise.all([
    db.select({ count: count() }).from(rooms).where(eq(rooms.active, true)),
    db.select({ count: count() }).from(employees).where(eq(employees.active, true)),
    db.select({ count: count() }).from(bookings).where(
      and(eq(bookings.checkIn, today), eq(bookings.status, 'confirmed'))
    ),
    db.select({
      id: bookings.id,
      guestName: bookings.guestName,
      checkIn: bookings.checkIn,
      checkOut: bookings.checkOut,
      roomId: bookings.roomId,
    })
      .from(bookings)
      .where(and(
        gte(bookings.checkIn, today),
        lte(bookings.checkIn, monthEnd),
        eq(bookings.status, 'confirmed'),
      ))
      .orderBy(bookings.checkIn)
      .limit(5),
    db.select({ id: payrollRuns.id, periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd })
      .from(payrollRuns)
      .where(eq(payrollRuns.status, 'draft'))
      .orderBy(payrollRuns.periodStart)
      .limit(3),
  ])

  const stats = [
    { label: 'Active Rooms',    value: activeRooms[0]?.count ?? 0,     icon: Home,          href: '/dashboard/bookings' },
    { label: 'Active Staff',    value: activeEmployees[0]?.count ?? 0,  icon: Users,         href: '/dashboard/payroll/employees' },
    { label: 'Check-ins Today', value: checkInsToday[0]?.count ?? 0,    icon: CalendarDays,  href: '/dashboard/bookings' },
    { label: 'Payroll Drafts',  value: draftRuns.length,                icon: DollarSign,    href: '/dashboard/payroll' },
  ]

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
        <p className="mt-1 text-sm text-gray-500">Kanaan Guest Farm — today is {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, href }) => (
          <Link key={label} href={href} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-gray-100 p-2">
                <Icon size={18} className="text-gray-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-2xl font-semibold text-gray-900">{value}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Upcoming check-ins */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Upcoming Check-ins</h2>
            <Link href="/dashboard/bookings" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          {upcomingBookings.length === 0 ? (
            <p className="text-sm text-gray-400">No upcoming bookings.</p>
          ) : (
            <div className="space-y-3">
              {upcomingBookings.map(b => (
                <Link key={b.id} href={`/dashboard/bookings/${b.id}`} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 hover:bg-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.guestName}</p>
                    <p className="text-xs text-gray-500">Room {b.roomId} · {b.checkIn} → {b.checkOut}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Draft payroll runs */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Payroll Drafts</h2>
            <Link href="/dashboard/payroll" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          {draftRuns.length === 0 ? (
            <p className="text-sm text-gray-400">No draft payroll runs.</p>
          ) : (
            <div className="space-y-3">
              {draftRuns.map(r => (
                <Link key={r.id} href={`/dashboard/payroll/${r.id}`} className="flex items-center justify-between rounded-lg bg-yellow-50 px-3 py-2 hover:bg-yellow-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Payroll Run #{r.id}</p>
                    <p className="text-xs text-gray-500">{r.periodStart} → {r.periodEnd}</p>
                  </div>
                  <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded-full">Draft</span>
                </Link>
              ))}
            </div>
          )}
          <Link href="/dashboard/payroll/new" className="mt-4 block text-center text-xs text-blue-600 hover:underline">+ New payroll run</Link>
        </div>
      </div>
    </div>
  )
}
