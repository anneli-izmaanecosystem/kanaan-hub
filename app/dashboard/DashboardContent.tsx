export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { bookings, payrollRuns, employees, rooms } from '@/lib/db/schema'
import { eq, gte, lte, and, count, ne } from 'drizzle-orm'
import { fmt } from '@/lib/utils'
import { todaySA } from '@/lib/date-sa'
import Link from 'next/link'
import { CalendarDays, Users, TrendingUp, Home, BarChart3 } from 'lucide-react'

function monthLabel(ym: string) {
  return new Date(ym + '-01').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

function surroundingMonths(current: string, n = 6): string[] {
  const months: string[] = []
  const [y, m] = current.split('-').map(Number)
  for (let i = -(n - 1); i <= 0; i++) {
    const d = new Date(y, m - 1 + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  // add next 2 months
  for (let i = 1; i <= 2; i++) {
    const d = new Date(y, m - 1 + i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export default async function DashboardContent({ searchParamsPromise }: { searchParamsPromise: Promise<{ month?: string }> }) {
  const searchParams = await searchParamsPromise
  const today = todaySA()
  const currentYM = today.slice(0, 7)
  const selectedMonth = searchParams.month ?? currentYM

  const [selYear, selMon] = selectedMonth.split('-').map(Number)
  const monthStart = `${selectedMonth}-01`
  const daysInMonth = new Date(selYear, selMon, 0).getDate()
  const monthEnd   = `${selectedMonth}-${String(daysInMonth).padStart(2, '0')}`
  const totalRooms = 25

  const [
    activeEmployees,
    upcomingBookings,
    draftRuns,
    monthBookings,
  ] = await Promise.all([
    db.select({ count: count() }).from(employees).where(eq(employees.active, true)),
    db.select({
      id:        bookings.id,
      guestName: bookings.guestName,
      checkIn:   bookings.checkIn,
      checkOut:  bookings.checkOut,
      roomName:  rooms.name,
      status:    bookings.status,
    })
      .from(bookings)
      .innerJoin(rooms, eq(bookings.roomId, rooms.id))
      .where(and(
        gte(bookings.checkIn, today),
        ne(bookings.status, 'cancelled'),
      ))
      .orderBy(bookings.checkIn)
      .limit(8),
    db.select({ id: payrollRuns.id, periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd })
      .from(payrollRuns)
      .where(eq(payrollRuns.status, 'draft'))
      .orderBy(payrollRuns.periodStart)
      .limit(3),
    db.select({
      id:          bookings.id,
      checkIn:     bookings.checkIn,
      checkOut:    bookings.checkOut,
      totalAmount: bookings.totalAmount,
      status:      bookings.status,
      roomId:      bookings.roomId,
    })
      .from(bookings)
      .where(and(
        lte(bookings.checkIn, monthEnd),
        gte(bookings.checkOut, monthStart),
        ne(bookings.status, 'cancelled'),
      )),
  ])

  // KPI calculations
  // Exclude quote_sent — unconfirmed quotes should not count as revenue
  const confirmedBookings = monthBookings.filter(b => b.status !== 'quote_sent')
  const bookingCount = confirmedBookings.length

  // Pro-rate revenue and occupancy by nights within the month.
  // A booking spanning a month boundary (e.g. Jun 28 → Jul 5) contributes only its
  // in-month fraction to this month's revenue, avoiding double-counting.
  let totalRevenue = 0
  let occupiedRoomNights = 0
  for (const b of confirmedBookings) {
    const checkInMs  = new Date(b.checkIn).getTime()
    const checkOutMs = new Date(b.checkOut).getTime()
    const s = Math.max(checkInMs, new Date(monthStart).getTime())
    const e = Math.min(checkOutMs, new Date(monthEnd).getTime() + 86_400_000)
    const nightsInMonth = Math.max(0, (e - s) / 86_400_000)
    const totalNights   = Math.max(1, (checkOutMs - checkInMs) / 86_400_000)
    occupiedRoomNights += nightsInMonth
    totalRevenue       += parseFloat(b.totalAmount || '0') * (nightsInMonth / totalNights)
  }
  const totalRoomNights = totalRooms * daysInMonth
  const occupancyRate  = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0
  const adr            = occupiedRoomNights > 0 ? totalRevenue / occupiedRoomNights : 0

  const months = surroundingMonths(currentYM)

  const statusDot: Record<string, string> = {
    fully_paid:     'bg-green-500',
    confirmed:      'bg-green-400',
    partially_paid: 'bg-yellow-400',
    quote_sent:     'bg-gray-400',
    unpaid:         'bg-orange-400',
    pending:        'bg-yellow-300',
    checked_in:     'bg-blue-400',
    checked_out:    'bg-gray-300',
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Month filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        {months.map(m => (
          <Link
            key={m}
            href={`/dashboard?month=${m}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              m === selectedMonth
                ? 'bg-gray-900 text-white border-gray-900'
                : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2"><TrendingUp size={18} className="text-green-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Occupancy Rate</p>
              <p className="text-2xl font-semibold text-gray-900">{occupancyRate.toFixed(1)}%</p>
              <p className="text-xs text-gray-400">{monthLabel(selectedMonth)}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-50 p-2"><BarChart3 size={18} className="text-blue-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Monthly Revenue</p>
              <p className="text-2xl font-semibold text-gray-900">{fmt(totalRevenue)}</p>
              <p className="text-xs text-gray-400">{bookingCount} bookings</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-50 p-2"><Home size={18} className="text-purple-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Avg Daily Rate</p>
              <p className="text-2xl font-semibold text-gray-900">{fmt(adr)}</p>
              <p className="text-xs text-gray-400">per room-night</p>
            </div>
          </div>
        </div>
        <Link href="/dashboard/payroll/employees" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gray-100 p-2"><Users size={18} className="text-gray-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Active Staff</p>
              <p className="text-2xl font-semibold text-gray-900">{activeEmployees[0]?.count ?? 0}</p>
            </div>
          </div>
        </Link>
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
            <div className="space-y-2">
              {upcomingBookings.map(b => (
                <Link key={b.id} href={`/dashboard/bookings/${b.id}`}
                  className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 hover:bg-gray-100">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot[b.status] ?? 'bg-gray-300'}`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.guestName}</p>
                      <p className="text-xs text-gray-500">{b.roomName} · {b.checkIn} → {b.checkOut}</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 ml-2">{b.checkIn}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Draft payroll / quick links */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Payroll Drafts</h2>
            <Link href="/dashboard/payroll" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          {draftRuns.length === 0 ? (
            <p className="text-sm text-gray-400">No draft payroll runs.</p>
          ) : (
            <div className="space-y-2">
              {draftRuns.map(r => (
                <Link key={r.id} href={`/dashboard/payroll/${r.id}`}
                  className="flex items-center justify-between rounded-lg bg-yellow-50 px-3 py-2 hover:bg-yellow-100">
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
