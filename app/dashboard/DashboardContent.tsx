export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { bookings, payrollRuns, workers, rooms } from '@/lib/db/schema'
import { eq, gte, lte, and, count, ne, sql } from 'drizzle-orm'
import { fmt } from '@/lib/utils'
import { todaySA } from '@/lib/date-sa'
import Link from 'next/link'
import { CalendarDays, Users, TrendingUp, Home, BarChart3, Receipt, Percent } from 'lucide-react'

const VAT_RATE = 0.15 // South Africa standard rate

function monthLabel(ym: string) {
  return new Date(ym + '-01').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

// Month chips span from `earliest` (or 6 months back, whichever is further back) through
// 2 months ahead of `current` — so older backfilled data stays reachable instead of being
// hidden behind a fixed 6-month lookback.
function surroundingMonths(current: string, earliest: string): string[] {
  const [cy, cm] = current.split('-').map(Number)
  const sixBack = new Date(cy, cm - 1 - 5, 1)
  const [ey, em] = earliest.split('-').map(Number)
  const earliestDate = new Date(ey, em - 1, 1)
  const start = earliestDate < sixBack ? earliestDate : sixBack
  const end = new Date(cy, cm - 1 + 2, 1)

  const months: string[] = []
  const d = new Date(start)
  while (d <= end) {
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
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

  const [
    activeEmployees,
    upcomingBookings,
    draftRuns,
    monthBookings,
    earliestBookingRow,
    activeRoomCount,
  ] = await Promise.all([
    db.select({ count: count() }).from(workers).where(eq(workers.active, true)),
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
      vatIncluded: bookings.vatIncluded,
      commissionAmount: bookings.commissionAmount,
      adults:      bookings.adults,
      children:    bookings.children,
    })
      .from(bookings)
      .where(and(
        lte(bookings.checkIn, monthEnd),
        gte(bookings.checkOut, monthStart),
        ne(bookings.status, 'cancelled'),
      )),
    db.select({ minCheckIn: sql<string | null>`MIN(${bookings.checkIn})` })
      .from(bookings)
      .where(ne(bookings.status, 'cancelled')),
    db.select({ count: count() }).from(rooms).where(eq(rooms.active, true)),
  ])
  // Total accommodation-unit count for occupancy — was hardcoded to 25, which went stale once
  // dorm beds and camp sites were added as separately-bookable rooms (now 29 active units).
  const totalRooms = activeRoomCount[0]?.count ?? 0

  // KPI calculations
  // Streamlined 2026-08: the old 'quote_sent' status (excluded from revenue) was folded into
  // 'unpaid_quoted' along with real-but-unpaid bookings, so quotes can no longer be told apart
  // from confirmed-unpaid stays. Revenue now counts every non-cancelled booking for the month.
  const revenueBookings = monthBookings
  const bookingCount = revenueBookings.length

  // Pro-rate revenue and occupancy by nights within the month.
  // A booking spanning a month boundary (e.g. Jun 28 → Jul 5) contributes only its
  // in-month fraction to this month's revenue, avoiding double-counting.
  let totalRevenueExclVat = 0
  let totalVat = 0
  let totalCommission = 0
  let occupiedRoomNights = 0
  let occupiedGuestNights = 0
  for (const b of revenueBookings) {
    const checkInMs  = new Date(b.checkIn).getTime()
    const checkOutMs = new Date(b.checkOut).getTime()
    const s = Math.max(checkInMs, new Date(monthStart).getTime())
    const e = Math.min(checkOutMs, new Date(monthEnd).getTime() + 86_400_000)
    const nightsInMonth = Math.max(0, (e - s) / 86_400_000)
    const totalNights   = Math.max(1, (checkOutMs - checkInMs) / 86_400_000)
    const fraction = nightsInMonth / totalNights
    const guests = (b.adults ?? 1) + (b.children ?? 0)

    const total    = parseFloat(b.totalAmount || '0')
    const exclVat  = b.vatIncluded ? total / (1 + VAT_RATE) : total
    const vat      = b.vatIncluded ? total - exclVat : 0
    const commission = parseFloat(b.commissionAmount || '0')

    occupiedRoomNights  += nightsInMonth
    occupiedGuestNights += nightsInMonth * guests
    totalRevenueExclVat += exclVat * fraction
    totalVat            += vat * fraction
    totalCommission     += commission * fraction
  }
  const totalRoomNights = totalRooms * daysInMonth
  const occupancyRate  = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0
  const adr            = occupiedGuestNights > 0 ? totalRevenueExclVat / occupiedGuestNights : 0

  const earliestMonth = earliestBookingRow[0]?.minCheckIn?.slice(0, 7) ?? currentYM
  const months = surroundingMonths(currentYM, earliestMonth)

  const statusDot: Record<string, string> = {
    booking_site:   'bg-blue-500',
    unpaid_quoted:  'bg-gray-400',
    deposit_paid:   'bg-purple-500',
    fully_paid:     'bg-green-500',
    cancelled:      'bg-red-400',
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
      <div className="grid grid-cols-3 gap-4 mb-8">
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
              <p className="text-xs text-gray-500">Revenue (excl VAT)</p>
              <p className="text-2xl font-semibold text-gray-900">{fmt(totalRevenueExclVat)}</p>
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
              <p className="text-xs text-gray-400">per person, per night</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2"><Receipt size={18} className="text-amber-600" /></div>
            <div>
              <p className="text-xs text-gray-500">VAT Amount</p>
              <p className="text-2xl font-semibold text-gray-900">{fmt(totalVat)}</p>
              <p className="text-xs text-gray-400">15% of VAT-inclusive bookings</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-50 p-2"><Percent size={18} className="text-orange-600" /></div>
            <div>
              <p className="text-xs text-gray-500">Commission</p>
              <p className="text-2xl font-semibold text-gray-900">{fmt(totalCommission)}</p>
              <p className="text-xs text-gray-400">incl. VAT, booking sites</p>
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
