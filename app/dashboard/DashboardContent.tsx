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
  // Construct from local-time components (not `new Date(ym + '-01')`, which parses as
  // UTC midnight) so viewers west of UTC don't see the label roll back a month.
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
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

  // Bed-night occupancy trend covers a fixed 12-month window ending this month, independent
  // of the selected-month KPI filter above — one wide query, bucketed by month in JS below,
  // instead of 12 separate round-trips.
  const [curY, curM] = currentYM.split('-').map(Number)
  const trendMonths: string[] = []
  {
    const d = new Date(curY, curM - 1 - 11, 1)
    for (let i = 0; i < 12; i++) {
      trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      d.setMonth(d.getMonth() + 1)
    }
  }
  const trendRangeStart = `${trendMonths[0]}-01`
  const [lastTrendY, lastTrendM] = trendMonths[trendMonths.length - 1].split('-').map(Number)
  const trendRangeEnd = `${trendMonths[trendMonths.length - 1]}-${String(new Date(lastTrendY, lastTrendM, 0).getDate()).padStart(2, '0')}`

  const [
    activeEmployees,
    upcomingBookings,
    draftRuns,
    monthBookings,
    earliestBookingRow,
    activeRooms,
    trendBookings,
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
    db.select({ id: rooms.id, type: rooms.type, capacity: rooms.capacity })
      .from(rooms).where(eq(rooms.active, true)),
    db.select({ roomId: bookings.roomId, checkIn: bookings.checkIn, checkOut: bookings.checkOut })
      .from(bookings)
      .where(and(
        lte(bookings.checkIn, trendRangeEnd),
        gte(bookings.checkOut, trendRangeStart),
        ne(bookings.status, 'cancelled'),
      )),
  ])
  // Occupancy is measured in bed-nights, not room-nights: room types range from a 2-sleeper
  // twin to an 8-sleeper family unit, so counting each as "1 room" understates how full the
  // property actually is. Bookings block the whole room (the API 409s on any overlap), so a
  // booking occupies its room's full capacity in beds regardless of actual guest headcount.
  // NOTE: room capacities are as entered in Settings — Room 8 (cap 8), Room 9 (cap 6), and
  // Dorm B - Bed 1 (cap 2) look anomalous next to their peers and may need correcting; that
  // would change totalSleepers and every occupancy % below.
  const roomCapacity = new Map(activeRooms.map(r => [r.id, r.capacity]))
  const roomType     = new Map(activeRooms.map(r => [r.id, r.type]))
  const totalSleepers = activeRooms.reduce((s, r) => s + r.capacity, 0)
  const sleepersByType = new Map<string, number>()
  for (const r of activeRooms) sleepersByType.set(r.type, (sleepersByType.get(r.type) ?? 0) + r.capacity)
  const totalRooms = activeRooms.length

  function bedNightsInRange(rows: { roomId: number; checkIn: string; checkOut: string }[], rangeStart: string, rangeEnd: string) {
    const rangeStartMs = new Date(rangeStart).getTime()
    const rangeEndMs   = new Date(rangeEnd).getTime() + 86_400_000 // checkOut is exclusive
    let total = 0
    const byType = new Map<string, number>()
    for (const b of rows) {
      const capacity = roomCapacity.get(b.roomId)
      if (capacity === undefined) continue // room since deactivated — excluded from both sides of the ratio
      const s = Math.max(new Date(b.checkIn).getTime(), rangeStartMs)
      const e = Math.min(new Date(b.checkOut).getTime(), rangeEndMs)
      const nights = Math.max(0, (e - s) / 86_400_000)
      const bedNights = nights * capacity
      total += bedNights
      const type = roomType.get(b.roomId)!
      byType.set(type, (byType.get(type) ?? 0) + bedNights)
    }
    return { total, byType }
  }

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

    occupiedGuestNights += nightsInMonth * guests
    totalRevenueExclVat += exclVat * fraction
    totalVat            += vat * fraction
    totalCommission     += commission * fraction
  }
  const adr = occupiedGuestNights > 0 ? totalRevenueExclVat / occupiedGuestNights : 0

  // Bed-night occupancy: beds_occupied = room.capacity (a booking blocks its whole room, per
  // the 409 conflict check in the booking API), not guest headcount — a couple in an 8-sleeper
  // family unit still occupies all 8 beds as far as saleable inventory is concerned.
  const availableBedNights = totalSleepers * daysInMonth
  const monthBedNights = bedNightsInRange(monthBookings, monthStart, monthEnd)
  const occupancyRate = availableBedNights > 0 ? (monthBedNights.total / availableBedNights) * 100 : 0
  const occupancyByType = ['premium', 'budget', 'dorm', 'camping'].map(type => {
    const sleepers = sleepersByType.get(type) ?? 0
    const available = sleepers * daysInMonth
    const booked = monthBedNights.byType.get(type) ?? 0
    return { type, sleepers, rate: available > 0 ? (booked / available) * 100 : 0 }
  }).filter(t => t.sleepers > 0)

  // Trend: bed-night occupancy for each of the last 12 months, bucketed from one wide query.
  const occupancyTrend = trendMonths.map(ym => {
    const [y, m] = ym.split('-').map(Number)
    const mStart = `${ym}-01`
    const mDays = new Date(y, m, 0).getDate()
    const mEnd = `${ym}-${String(mDays).padStart(2, '0')}`
    const { total } = bedNightsInRange(trendBookings, mStart, mEnd)
    const available = totalSleepers * mDays
    return { ym, bedNights: total, rate: available > 0 ? (total / available) * 100 : 0 }
  })

  // Breakeven model — Kanaan Guest Farm Unit Economics (excl. VAT), per Anneli's 2026-09-01
  // costing doc. Occupied bed-nights come from real bookings (actual room capacity), but every
  // Rand figure below is that doc's fixed model, calibrated against its own 54-sleeper/30-day
  // baseline (1,620 bed-nights/month) — independent of whatever totalSleepers resolves to above.
  const ADR_EXCL_VAT             = 252.17 // short-term rate, R290 incl. VAT
  const AVG_LENGTH_OF_STAY       = 2      // nights per stay — sets how often a bed's laundry turns over
  const LAUNDRY_PER_STAY_EXCL_VAT = 31.64 // per single-bed set, net + 10%
  const FIXED_COSTS_EXCL_VAT     = 42_565.22 // electricity + wifi/DStv + cleaning products + gardening
  const DEPRECIATION_EXCL_VAT    = 6_712.92  // linen + kitchen equipment + bathrooms + beds
  const HOUSEKEEPING_FLAT        = 6_240.00  // 1 lady x R240/day x 26 days — no VAT, wages aren't VATable
  const CONTINGENCY_RATE         = 0.05
  const FIXED_MONTHLY_BASE = FIXED_COSTS_EXCL_VAT + DEPRECIATION_EXCL_VAT + HOUSEKEEPING_FLAT

  function breakevenPnL(bedNights: number) {
    const revenue = bedNights * ADR_EXCL_VAT
    const laundry = (bedNights / AVG_LENGTH_OF_STAY) * LAUNDRY_PER_STAY_EXCL_VAT
    const totalCost = (FIXED_MONTHLY_BASE + laundry) * (1 + CONTINGENCY_RATE)
    return { revenue, totalCost, profit: revenue - totalCost }
  }
  const breakevenTrend = occupancyTrend.map(t => ({ ym: t.ym, ...breakevenPnL(t.bedNights) }))
  const breakevenMaxVal = Math.max(...breakevenTrend.map(t => Math.max(t.revenue, t.totalCost)), 1)
  // Solve revenue(BN) = totalCost(BN) for BN directly, rather than hardcoding the doc's ~15.3% —
  // ADR·BN = (FIXED_MONTHLY_BASE + BN/ALOS·LAUNDRY)·(1+c)  =>  BN = FIXED_MONTHLY_BASE·(1+c) / (ADR - LAUNDRY·(1+c)/ALOS)
  const breakevenBedNights = (FIXED_MONTHLY_BASE * (1 + CONTINGENCY_RATE)) / (ADR_EXCL_VAT - (LAUNDRY_PER_STAY_EXCL_VAT * (1 + CONTINGENCY_RATE)) / AVG_LENGTH_OF_STAY)
  const breakevenOccupancyPct = (breakevenBedNights / 1620) * 100 // doc's own 54-sleeper x 30-day baseline

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
              <p className="text-xs text-gray-400">{monthLabel(selectedMonth)} · {totalSleepers} beds, {totalRooms} rooms</p>
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

      {/* Occupancy breakdown + trend (bed-night basis) */}
      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Occupancy by Room Type — {monthLabel(selectedMonth)}</h2>
          <div className="space-y-3">
            {occupancyByType.map(t => (
              <div key={t.type}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="capitalize text-gray-600">{t.type} <span className="text-gray-400">({t.sleepers} beds)</span></span>
                  <span className="font-medium text-gray-900">{t.rate.toFixed(1)}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, t.rate)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 mb-4">Occupancy Trend — Last 12 Months</h2>
          <div className="flex items-end gap-1.5 h-32">
            {occupancyTrend.map(t => {
              const heightPct = Math.max(2, Math.min(100, t.rate))
              const isCurrent = t.ym === currentYM
              return (
                <div key={t.ym} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                  <span className="text-[10px] text-gray-500 mb-1">{t.rate.toFixed(0)}%</span>
                  <div
                    className={`w-full rounded-t ${isCurrent ? 'bg-gray-900' : 'bg-green-400'}`}
                    style={{ height: `${heightPct}%` }}
                    title={`${monthLabel(t.ym)}: ${t.rate.toFixed(1)}%`}
                  />
                  <span className="text-[10px] text-gray-400 mt-1">{monthLabel(t.ym).slice(0, 3)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Breakeven analysis */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm mb-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-gray-700">Breakeven Analysis — Last 12 Months (excl. VAT)</h2>
          <span className="text-xs text-gray-400">
            Breakeven ≈ {Math.round(breakevenBedNights)} bed-nights/mo (~{breakevenOccupancyPct.toFixed(1)}% occupancy)
          </span>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Revenue vs. total cost (fixed + depreciation + housekeeping + laundry, +5% contingency) from actual bookings each month
        </p>
        <div className="flex items-end gap-3 h-40">
          {breakevenTrend.map(t => {
            const revH  = Math.max(2, (t.revenue   / breakevenMaxVal) * 100)
            const costH = Math.max(2, (t.totalCost / breakevenMaxVal) * 100)
            const isProfit = t.profit >= 0
            return (
              <div key={t.ym} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className={`text-[10px] font-medium mb-1 whitespace-nowrap ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                  {isProfit ? '+' : '−'}{fmt(Math.abs(t.profit))}
                </span>
                <div className="flex items-end gap-0.5 w-full h-full">
                  <div className="flex-1 rounded-t bg-blue-400" style={{ height: `${revH}%` }} title={`Revenue: ${fmt(t.revenue)}`} />
                  <div className="flex-1 rounded-t bg-gray-300" style={{ height: `${costH}%` }} title={`Total cost: ${fmt(t.totalCost)}`} />
                </div>
                <span className="text-[10px] text-gray-400 mt-1">{monthLabel(t.ym).slice(0, 3)}</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Revenue</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Total cost</span>
          <span>Profit/loss labeled above each month</span>
        </div>
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
