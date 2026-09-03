'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Plus, Grid3X3, List, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Pencil, CheckCircle, Circle, RefreshCw, Tag, Download } from 'lucide-react'
import { fmtDate, fmt, cn } from '@/lib/utils'
import { todaySA, addDaysSA } from '@/lib/date-sa'
import { isBookingIncomplete, missingBookingFields, FIELD_LABELS } from '@/lib/booking-completeness'

const WINDOW_DAYS = 120            // total rendered day-columns (~4 calendar months) — plain table, fine at this scale
const INITIAL_BACKWARD_DAYS = 14   // default rangeStart = today - 14, so "today" isn't pinned to the very left edge
const JUMP_DAYS = 30               // increment for the back/today/forward nav buttons

type Room = { id: number; name: string; type: string }
type Booking = {
  booking: {
    id: number; guestName: string; checkIn: string; checkOut: string
    status: string; adults: number; totalAmount: string; balanceDue: string; depositPaid: string
    paymentMethod: string | null; source: string | null; sourceOther: string | null
    invoiceNumber: string | null; payDate: string | null
  }
  room: Room       // primary room — kept for legacy display
  rooms: Room[]    // all rooms occupied by this booking
}

const STATUS_COLORS: Record<string, string> = {
  booking_site:   'bg-blue-100 text-blue-800',
  unpaid_quoted:  'bg-gray-100 text-gray-700',
  deposit_paid:   'bg-purple-100 text-purple-800',
  fully_paid:     'bg-green-100 text-green-800',
  cancelled:      'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  booking_site:  'Booking Site',
  unpaid_quoted: 'Unpaid / Quoted',
  deposit_paid:  'Deposit Paid',
  fully_paid:    'Fully Paid',
  cancelled:     'Cancelled',
}

const GRID_CELL: Record<string, string> = {
  booking_site:   'bg-blue-100 text-blue-900',
  unpaid_quoted:  'bg-gray-100 text-gray-700',
  deposit_paid:   'bg-purple-100 text-purple-900',
  fully_paid:     'bg-green-100 text-green-900',
  cancelled:      'bg-red-50 text-red-400',
}

const SOURCE_LABEL: Record<string, string> = {
  direct_walkin: 'Direct/Walk-in',
  booking_com:   'Booking.com',
  lekkaslaap:    'Lekkaslaap',
  other:         'Other',
}

function sourceLabel(source: string | null, sourceOther: string | null): string {
  if (!source) return '—'
  if (source === 'other') return sourceOther || 'Other'
  return SOURCE_LABEL[source] ?? source
}

type AccomTab = 'lodge' | 'backpackers' | 'camping'
const ACCOM_TABS: { key: AccomTab; label: string }[] = [
  { key: 'lodge',       label: 'Lodge' },
  { key: 'backpackers', label: 'Backpackers' },
  { key: 'camping',     label: 'Camping' },
]

const DEFAULT_RANGE_START = () => addDaysSA(todaySA(), -INITIAL_BACKWARD_DAYS)

export default function BookingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <BookingsPageContent />
    </Suspense>
  )
}

function BookingsPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [view, setView]         = useState<'grid' | 'list'>(() => searchParams.get('view') === 'list' ? 'list' : 'grid')
  const [tab, setTab]           = useState<AccomTab>('lodge')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms]       = useState<Room[]>([])
  const [loading, setLoading]   = useState(true)
  const [rangeStart, setRangeStart] = useState(() => searchParams.get('rangeStart') || DEFAULT_RANGE_START())
  const [showAll, setShowAll]   = useState(() => searchParams.get('all') === '1')
  const rangeEnd = addDaysSA(rangeStart, WINDOW_DAYS - 1)

  // Keep the URL in sync with the current view/window so navigating away (e.g. to edit a
  // booking) and coming back via router.back() restores exactly where the user was, instead
  // of always landing back on today's default grid window.
  useEffect(() => {
    const params = new URLSearchParams()
    if (view !== 'grid') params.set('view', view)
    if (rangeStart !== DEFAULT_RANGE_START()) params.set('rangeStart', rangeStart)
    if (showAll) params.set('all', '1')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [view, rangeStart, showAll])

  useEffect(() => {
    setLoading(true)
    const url = (view === 'list' && showAll)
      ? '/api/bookings'
      : `/api/bookings?from=${rangeStart}&to=${rangeEnd}`
    Promise.all([
      fetch(url, { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/rooms', { cache: 'no-store' }).then(r => r.json()),
    ]).then(([b, r]) => {
      setBookings(Array.isArray(b) ? b : [])
      setRooms(Array.isArray(r) ? r : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [view, rangeStart, showAll])

  function jumpBack()    { setRangeStart(r => addDaysSA(r, -JUMP_DAYS)) }
  function jumpForward() { setRangeStart(r => addDaysSA(r, JUMP_DAYS)) }
  function jumpToday()   { setRangeStart(addDaysSA(todaySA(), -INITIAL_BACKWARD_DAYS)) }

  const tabRooms = rooms.filter(r => {
    if (tab === 'lodge')       return r.type === 'premium' || r.type === 'budget'
    if (tab === 'backpackers') return r.type === 'dorm'
    if (tab === 'camping')     return r.type === 'camping'
    return true
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">Bookings</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('grid')} title="Room Grid"
              className={cn('px-3 py-1.5 text-sm', view === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50')}>
              <Grid3X3 size={16} />
            </button>
            <button onClick={() => setView('list')} title="List"
              className={cn('px-3 py-1.5 text-sm', view === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50')}>
              <List size={16} />
            </button>
          </div>
          <Link href="/dashboard/bookings/sync" title="Booking.com Sync"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900">
            <RefreshCw size={16} />
          </Link>
          <Link href="/dashboard/pricelist" title="Pricelist"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900">
            <Tag size={16} />
          </Link>
          <Link href="/dashboard/bookings/new"
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Plus size={16} /> New Booking
          </Link>
        </div>
      </div>

      {/* Accommodation tabs (grid view only) */}
      {view === 'grid' && (
        <div className="flex border-b border-gray-200 mb-4">
          {ACCOM_TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                tab === t.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Grid navigator: slide the loaded window back/forward, or jump to today */}
      {view === 'grid' && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={jumpBack} title="Back 30 days" className="rounded-md p-1 hover:bg-gray-100"><ChevronLeft size={18} /></button>
          <button onClick={jumpToday} className="rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors">
            Today
          </button>
          <button onClick={jumpForward} title="Forward 30 days" className="rounded-md p-1 hover:bg-gray-100"><ChevronRight size={18} /></button>
          <span className="text-sm text-gray-500">{fmtDate(rangeStart)} – {fmtDate(rangeEnd)}</span>
        </div>
      )}

      {/* List navigator: toggle between the current rolling window and full history */}
      {view === 'list' && (
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setShowAll(v => !v)}
            className={cn(
              'rounded-lg border px-3 py-1 text-xs font-medium transition-colors',
              showAll
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700'
            )}
          >
            All bookings
          </button>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs text-gray-500 flex-wrap">
        {[
          ['booking_site','Booking Site'], ['unpaid_quoted','Unpaid / Quoted'],
          ['deposit_paid','Deposit Paid'], ['fully_paid','Fully Paid'],
        ].map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn('w-3 h-3 rounded-sm inline-block', GRID_CELL[k]?.split(' ')[0])} />
            {label}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : view === 'grid' ? (
        <RoomGrid bookings={bookings} rooms={tabRooms} rangeStart={rangeStart} rangeEnd={rangeEnd} />
      ) : (
        <BookingList bookings={bookings} showAll={showAll} setShowAll={setShowAll} onTogglePaid={async (id, totalAmount, currentlyPaid) => {
          const patch = currentlyPaid
            ? { status: 'unpaid_quoted', depositPaid: '0', balanceDue: totalAmount }
            : { status: 'fully_paid', depositPaid: totalAmount, balanceDue: '0' }
          await fetch(`/api/bookings/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          setBookings(prev => prev.map(b =>
            b.booking.id === id
              ? { ...b, booking: { ...b.booking, ...patch } }
              : b
          ))
        }} />
      )}
    </div>
  )
}

type DayCol = { date: string; day: number; month: number; year: number; dow: number }

function buildDays(rangeStart: string, count: number): DayCol[] {
  return Array.from({ length: count }, (_, i) => {
    const dateStr = addDaysSA(rangeStart, i)
    const d = new Date(dateStr + 'T12:00:00Z')
    return { date: dateStr, day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear(), dow: d.getUTCDay() }
  })
}

function groupByMonth(days: DayCol[]) {
  const groups: { key: string; label: string; span: number }[] = []
  for (const d of days) {
    const key = `${d.year}-${d.month}`
    const last = groups[groups.length - 1]
    if (last?.key === key) last.span++
    else groups.push({
      key,
      label: new Date(d.year, d.month, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
      span: 1,
    })
  }
  return groups
}

function RoomGrid({ bookings, rooms, rangeStart, rangeEnd }: { bookings: Booking[]; rooms: Room[]; rangeStart: string; rangeEnd: string }) {
  const today = todaySA()
  const days = buildDays(rangeStart, WINDOW_DAYS)
  const monthGroups = groupByMonth(days)
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayColRef = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (todayColRef.current) {
      container.scrollLeft = todayColRef.current.offsetLeft - 90 // offset by sticky room-name column width
    } else {
      container.scrollLeft = 0 // today isn't in this window (user jumped away) — show window start
    }
  }, [rangeStart])

  // Build a map: roomId-date → booking (plotted once per room it occupies)
  const cellMap = new Map<string, Booking['booking'] & { roomName: string }>()
  for (const { booking, rooms: bookingRooms } of bookings) {
    if (booking.status === 'cancelled') continue
    const start = new Date(Math.max(new Date(booking.checkIn).getTime(), new Date(rangeStart + 'T00:00:00Z').getTime()))
    // Use inclusive end when checkIn === checkOut (no checkout specified → API defaults to checkIn)
    const endMs = new Date(booking.checkOut).getTime() + (booking.checkIn === booking.checkOut ? 86_400_000 : 0)
    for (const room of bookingRooms) {
      for (let d = new Date(start); d.getTime() < endMs; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0]
        if (dateStr < rangeStart || dateStr > rangeEnd) continue
        cellMap.set(`${room.id}-${dateStr}`, { ...booking, roomName: room.name })
      }
    }
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="border-collapse text-xs" style={{ minWidth: `${90 + days.length * 36}px` }}>
        <thead>
          <tr>
            <th rowSpan={2} className="sticky left-0 z-20 bg-gray-800 text-white px-3 py-2 text-left text-xs font-medium min-w-[90px] align-bottom">
              Room
            </th>
            {monthGroups.map(g => (
              <th key={g.key} colSpan={g.span}
                className="text-center py-1 font-semibold border-l border-gray-700 bg-gray-900 text-gray-200 text-xs">
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            {days.map(d => {
              const isToday = d.date === today
              const isWeekend = d.dow === 0 || d.dow === 6
              return (
                <th key={d.date}
                  ref={isToday ? todayColRef : undefined}
                  className={cn(
                    'text-center py-1 font-normal border-l border-gray-200 w-9',
                    isToday ? 'bg-blue-700 text-white' : isWeekend ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-300'
                  )}
                >
                  <div className="font-semibold">{d.day}</div>
                  <div className="text-[9px] opacity-70">{DOW[d.dow]}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rooms.map((room, ri) => (
            <tr key={room.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="sticky left-0 z-10 bg-inherit border-r border-gray-200 px-3 py-1 font-medium text-gray-700 whitespace-nowrap">
                {room.name}
              </td>
              {days.map(d => {
                const booking = cellMap.get(`${room.id}-${d.date}`)
                const isToday = d.date === today
                const isWeekend = d.dow === 0 || d.dow === 6

                if (booking) {
                  return (
                    <td key={d.date}
                      className={cn(
                        'border-l border-gray-100 h-8 px-1 overflow-hidden',
                        GRID_CELL[booking.status] ?? 'bg-green-100',
                        isToday && 'outline outline-2 outline-blue-400 outline-offset-[-2px]'
                      )}
                    >
                      <Link href={`/dashboard/bookings/${booking.id}`}
                        className="block truncate hover:underline font-medium text-[10px] leading-tight"
                        title={`${booking.guestName} · ${STATUS_LABEL[booking.status] ?? booking.status}`}>
                        {booking.guestName.split(' ')[0]}
                      </Link>
                    </td>
                  )
                }

                return (
                  <td key={d.date}
                    className={cn(
                      'border-l border-gray-100 h-8',
                      isToday ? 'bg-blue-50' : isWeekend ? 'bg-gray-50' : ''
                    )}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type SortKey = 'guestName' | 'roomName' | 'checkIn' | 'checkOut' | 'status' | 'totalAmount' | 'balanceDue' | 'payDate' | 'depositPaid'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown size={12} className="inline ml-1 opacity-30" />
  return sort.dir === 'asc'
    ? <ChevronUp size={12} className="inline ml-1 text-gray-900" />
    : <ChevronDown size={12} className="inline ml-1 text-gray-900" />
}

function BookingList({ bookings, showAll, setShowAll, onTogglePaid }: {
  bookings: Booking[]
  showAll: boolean
  setShowAll: (v: boolean | ((prev: boolean) => boolean)) => void
  onTogglePaid: (id: number, totalAmount: string, currentlyPaid: boolean) => Promise<void>
}) {
  const [sort, setSort]               = useState<{ key: SortKey; dir: SortDir }>({ key: 'checkIn', dir: 'asc' })
  const [search, setSearch]           = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<string>>(new Set())
  const [paymentMethodFilters, setPaymentMethodFilters] = useState<Set<string>>(new Set())
  const [showCancelled, setShowCancelled] = useState(false)
  const [payDateFrom, setPayDateFrom] = useState('')
  const [payDateTo, setPayDateTo]     = useState('')
  const [paying, setPaying]           = useState<number | null>(null)
  const [page, setPage]               = useState(1)
  const today = todaySA()
  const PAGE_SIZE = 50

  // A pay-date filter is a reconciliation query against full history — the rolling
  // checkIn/checkOut window this page normally fetches would silently drop bookings
  // paid in-range but checked in outside it, so force "All bookings" on as soon as
  // either date is set.
  useEffect(() => {
    if ((payDateFrom || payDateTo) && !showAll) setShowAll(true)
  }, [payDateFrom, payDateTo])

  // Any change to what's shown should bring the user back to page 1 — otherwise
  // narrowing a filter can strand them on a now-empty trailing page.
  useEffect(() => {
    setPage(1)
  }, [search, statusFilters, paymentMethodFilters, showCancelled, payDateFrom, payDateTo, sort, bookings])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const nonCancelledStatuses = Array.from(
    new Set(bookings.filter(b => b.booking.status !== 'cancelled').map(b => b.booking.status))
  ).sort()

  function toggleStatus(s: string) {
    setStatusFilters(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const paymentMethods = Array.from(
    new Set(bookings.map(b => b.booking.paymentMethod).filter((m): m is string => !!m))
  ).sort()

  function togglePaymentMethod(m: string) {
    setPaymentMethodFilters(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  }

  const isAll = statusFilters.size === 0
  const isAllPayment = paymentMethodFilters.size === 0

  const filtered = bookings
    .filter(({ booking, rooms: bookingRooms }) => {
      if (booking.status === 'cancelled' && !showCancelled) return false
      if (!isAll && !statusFilters.has(booking.status)) return false
      if (!isAllPayment && !paymentMethodFilters.has(booking.paymentMethod ?? '')) return false
      if (payDateFrom && (!booking.payDate || booking.payDate < payDateFrom)) return false
      if (payDateTo && (!booking.payDate || booking.payDate > payDateTo)) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          booking.guestName.toLowerCase().includes(q) ||
          bookingRooms.some(r => r.name.toLowerCase().includes(q)) ||
          sourceLabel(booking.source, booking.sourceOther).toLowerCase().includes(q)
        )
      }
      return true
    })
    .sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      const roomNameA = a.rooms.map(r => r.name).join(', ')
      const roomNameB = b.rooms.map(r => r.name).join(', ')
      switch (sort.key) {
        case 'guestName':   return dir * a.booking.guestName.localeCompare(b.booking.guestName)
        case 'roomName':    return dir * roomNameA.localeCompare(roomNameB, undefined, { numeric: true })
        case 'checkIn':     return dir * a.booking.checkIn.localeCompare(b.booking.checkIn)
        case 'checkOut':    return dir * a.booking.checkOut.localeCompare(b.booking.checkOut)
        case 'status':      return dir * a.booking.status.localeCompare(b.booking.status)
        case 'totalAmount': return dir * (parseFloat(a.booking.totalAmount) - parseFloat(b.booking.totalAmount))
        case 'balanceDue':  return dir * (parseFloat(a.booking.balanceDue) - parseFloat(b.booking.balanceDue))
        case 'depositPaid': return dir * (parseFloat(a.booking.depositPaid) - parseFloat(b.booking.depositPaid))
        case 'payDate':     return dir * (a.booking.payDate ?? '').localeCompare(b.booking.payDate ?? '')
        default: return 0
      }
    })

  const totalPaid = filtered.reduce((sum, { booking }) => sum + parseFloat(booking.depositPaid || '0'), 0)

  // Pagination applies only to what's rendered in the table — CSV export and the
  // paid-total summary above always operate on the full `filtered` set.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSafe    = Math.min(page, totalPages)
  const pageStart   = (pageSafe - 1) * PAGE_SIZE
  const paged       = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  function downloadCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = String(v ?? '')
      // Also quote on ';' — the Room(s) column joins multiple rooms with '; ', and
      // some regional Excel/Sheets configurations (common in ZA/EU locales) treat
      // semicolon as the CSV delimiter, splitting an unquoted multi-room field
      // across several columns instead of keeping it as one.
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'Guest', 'Room(s)', 'Check-in', 'Check-out', 'Status', 'Source',
      'Payment Method', 'Invoice #', 'Pay Date', 'Total Amount', 'Amount Paid', 'Balance Due',
    ]
    const rows = filtered.map(({ booking, rooms: bookingRooms }) => [
      booking.guestName,
      bookingRooms.map(r => r.name).join(' / '),
      booking.checkIn,
      booking.checkOut,
      STATUS_LABEL[booking.status] ?? booking.status,
      sourceLabel(booking.source, booking.sourceOther),
      booking.paymentMethod,
      booking.invoiceNumber,
      booking.payDate,
      booking.totalAmount,
      booking.depositPaid,
      booking.balanceDue,
    ])
    const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }) // BOM so Excel reads UTF-8 correctly
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const range = payDateFrom || payDateTo ? `_${payDateFrom || 'start'}_to_${payDateTo || 'now'}` : ''
    a.href = url
    a.download = `bookings${range}_${todaySA()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const th = (label: string, key: SortKey, align = 'left') => (
    <th
      onClick={() => toggleSort(key)}
      className={cn(
        'px-4 py-3 cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 transition-colors',
        `text-${align}`,
        sort.key === key ? 'text-gray-900 font-semibold' : 'text-gray-500 font-medium'
      )}
    >
      {label}<SortIcon col={key} sort={sort} />
    </th>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search guest, room, source…"
              className="pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span>Paid:</span>
            <input
              type="date"
              value={payDateFrom}
              onChange={e => setPayDateFrom(e.target.value)}
              className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            <span>–</span>
            <input
              type="date"
              value={payDateTo}
              onChange={e => setPayDateTo(e.target.value)}
              className="rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            {(payDateFrom || payDateTo) && (
              <button onClick={() => { setPayDateFrom(''); setPayDateTo('') }} className="text-gray-400 hover:text-gray-700">
                <X size={13} />
              </button>
            )}
          </div>
          <button
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            title="Download the filtered list as CSV"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40"
          >
            <Download size={13} /> Download CSV
          </button>
          <span className="text-xs text-gray-400 ml-auto">
            {filtered.length} of {bookings.length} · Paid total {fmt(totalPaid)}
          </span>
        </div>

        {/* Status chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilters(new Set())}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
              isAll
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
            )}
          >
            All
          </button>
          {nonCancelledStatuses.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                statusFilters.has(s)
                  ? cn(STATUS_COLORS[s], 'border-transparent')
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
              )}
            >
              {STATUS_LABEL[s] ?? s}
            </button>
          ))}
          <button
            onClick={() => setShowCancelled(v => !v)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition-colors ml-2',
              showCancelled
                ? 'bg-red-100 text-red-700 border-red-200'
                : 'bg-white text-gray-400 border-gray-200 hover:border-red-200 hover:text-red-500'
            )}
          >
            {showCancelled ? 'Hide Cancelled' : 'Show Cancelled'}
          </button>
        </div>

        {/* Payment method chips */}
        {paymentMethods.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400">Payment:</span>
            <button
              onClick={() => setPaymentMethodFilters(new Set())}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                isAllPayment
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
              )}
            >
              All
            </button>
            {paymentMethods.map(m => (
              <button
                key={m}
                onClick={() => togglePaymentMethod(m)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                  paymentMethodFilters.has(m)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No bookings match your filters.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs border-b border-gray-200">
              <tr>
                {th('Guest', 'guestName')}
                {th('Room', 'roomName')}
                {th('Check-in', 'checkIn')}
                {th('Check-out', 'checkOut')}
                {th('Status', 'status')}
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Source</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Payment</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Invoice #</th>
                {th('Pay Date', 'payDate')}
                {th('Total', 'totalAmount', 'right')}
                {th('Paid', 'depositPaid', 'right')}
                {th('Balance', 'balanceDue', 'right')}
                <th className="px-3 py-3 text-center text-gray-500 font-medium text-xs">Paid</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.map(({ booking, rooms: bookingRooms }) => (
                <tr key={booking.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{booking.guestName}</td>
                  <td className="px-4 py-3 text-gray-600">{bookingRooms.map(r => r.name).join(', ')}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkIn)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkOut)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[booking.status] ?? 'bg-gray-100')}>
                        {STATUS_LABEL[booking.status] ?? booking.status}
                      </span>
                      {isBookingIncomplete(booking, today) && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700"
                          title={`Missing: ${missingBookingFields(booking).map(f => FIELD_LABELS[f]).join(', ')}`}
                        >
                          Needs Info
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{sourceLabel(booking.source, booking.sourceOther)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{booking.paymentMethod ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {booking.invoiceNumber === 'N/A' ? '#N/A' : (booking.invoiceNumber || '—')}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{booking.payDate ? fmtDate(booking.payDate) : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700">R {parseFloat(booking.totalAmount).toFixed(0)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">R {parseFloat(booking.depositPaid).toFixed(0)}</td>
                  <td className={cn('px-4 py-3 text-right font-medium text-xs', parseFloat(booking.balanceDue) > 0 ? 'text-red-600' : 'text-green-600')}>
                    R {parseFloat(booking.balanceDue).toFixed(0)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {(() => {
                      const isPaid = parseFloat(booking.balanceDue) === 0
                      return (
                        <button
                          onClick={async () => {
                            setPaying(booking.id)
                            await onTogglePaid(booking.id, booking.totalAmount, isPaid)
                            setPaying(null)
                          }}
                          disabled={paying === booking.id}
                          title={isPaid ? 'Click to unmark paid' : 'Mark as fully paid'}
                          className="disabled:opacity-50"
                        >
                          {isPaid
                            ? <CheckCircle size={18} className="text-green-500 hover:text-green-700 transition-colors" />
                            : <Circle size={18} className="text-gray-300 hover:text-green-400 transition-colors" />
                          }
                        </button>
                      )
                    })()}
                  </td>
                  <td className="px-3 py-3 flex items-center gap-1.5">
                    <Link href={`/dashboard/bookings/${booking.id}`}
                      className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap">
                      <Pencil size={11} /> Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5 text-xs text-gray-500">
              <span>
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={pageSafe === 1}
                  className="rounded-md border border-gray-200 px-2 py-1 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Previous
                </button>
                <span>Page {pageSafe} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={pageSafe === totalPages}
                  className="rounded-md border border-gray-200 px-2 py-1 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
