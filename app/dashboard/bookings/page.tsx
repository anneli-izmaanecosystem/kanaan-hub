'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Grid3X3, List, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Search, X, Pencil } from 'lucide-react'
import { fmtDate, cn } from '@/lib/utils'

type Room = { id: number; name: string; type: string }
type Booking = {
  booking: {
    id: number; guestName: string; checkIn: string; checkOut: string
    status: string; adults: number; totalAmount: string; balanceDue: string
    paymentMethod: string | null; source: string | null
  }
  room: { id: number; name: string; type: string }
}

const STATUS_COLORS: Record<string, string> = {
  fully_paid:     'bg-green-100 text-green-800',
  confirmed:      'bg-green-100 text-green-800',
  partially_paid: 'bg-yellow-100 text-yellow-800',
  unpaid:         'bg-orange-100 text-orange-800',
  quote_sent:     'bg-gray-100 text-gray-700',
  pending:        'bg-yellow-100 text-yellow-800',
  checked_in:     'bg-blue-100 text-blue-800',
  checked_out:    'bg-gray-100 text-gray-700',
  cancelled:      'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  fully_paid: 'Fully Paid', confirmed: 'Confirmed', partially_paid: 'Partial',
  unpaid: 'Unpaid', quote_sent: 'Quote', pending: 'Pending',
  checked_in: 'In', checked_out: 'Out', cancelled: 'Cancelled',
}

// Grid cell colours matching original
const GRID_CELL: Record<string, string> = {
  fully_paid:     'bg-green-100 text-green-900',
  confirmed:      'bg-green-100 text-green-900',
  partially_paid: 'bg-yellow-100 text-yellow-900',
  unpaid:         'bg-orange-100 text-orange-900',
  quote_sent:     'bg-gray-100 text-gray-700',
  pending:        'bg-yellow-100 text-yellow-900',
  checked_in:     'bg-blue-100 text-blue-900',
  checked_out:    'bg-gray-50 text-gray-500',
  cancelled:      'bg-red-50 text-red-400',
}

export default function BookingsPage() {
  const [view, setView]         = useState<'grid' | 'list'>('grid')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms]       = useState<Room[]>([])
  const [loading, setLoading]   = useState(true)
  const [month, setMonth]       = useState(() => new Date().toISOString().slice(0, 7))

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/bookings?month=${month}`).then(r => r.json()),
      fetch('/api/rooms').then(r => r.json()),
    ]).then(([b, r]) => {
      setBookings(Array.isArray(b) ? b : [])
      setRooms(Array.isArray(r) ? r : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [month])

  function prevMonth() {
    const d = new Date(month + '-01'); d.setMonth(d.getMonth() - 1)
    setMonth(d.toISOString().slice(0, 7))
  }
  function nextMonth() {
    const d = new Date(month + '-01'); d.setMonth(d.getMonth() + 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

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
          <Link href="/dashboard/bookings/new"
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Plus size={16} /> New Booking
          </Link>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={prevMonth} className="rounded-md p-1 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <span className="text-sm font-medium text-gray-700 w-40 text-center">{monthLabel}</span>
        <button onClick={nextMonth} className="rounded-md p-1 hover:bg-gray-100"><ChevronRight size={18} /></button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs text-gray-500 flex-wrap">
        {[
          ['fully_paid','Fully Paid'], ['partially_paid','Partially Paid'],
          ['unpaid','Unpaid'], ['quote_sent','Quote Sent'],
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
        <RoomGrid bookings={bookings} rooms={rooms} month={month} />
      ) : (
        <BookingList bookings={bookings} />
      )}
    </div>
  )
}

function RoomGrid({ bookings, rooms, month }: { bookings: Booking[]; rooms: Room[]; month: string }) {
  const [selYear, selMon] = month.split('-').map(Number)
  const daysInMonth = new Date(selYear, selMon, 0).getDate()
  const today = new Date().toISOString().split('T')[0]
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']

  // Build a map: roomId → date → booking
  const cellMap = new Map<string, Booking['booking'] & { roomName: string }>()
  for (const { booking, room } of bookings) {
    if (booking.status === 'cancelled') continue
    const start = new Date(Math.max(new Date(booking.checkIn).getTime(), new Date(month + '-01').getTime()))
    const end   = new Date(booking.checkOut) // exclusive
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      if (dateStr.slice(0, 7) !== month) continue
      cellMap.set(`${room.id}-${dateStr}`, { ...booking, roomName: room.name })
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="border-collapse text-xs" style={{ minWidth: `${90 + daysInMonth * 36}px` }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-20 bg-gray-800 text-white px-3 py-2 text-left text-xs font-medium min-w-[90px]">
              Room
            </th>
            {days.map(d => {
              const dateStr = `${month}-${String(d).padStart(2, '0')}`
              const dow = new Date(dateStr).getDay()
              const isToday = dateStr === today
              const isWeekend = dow === 0 || dow === 6
              return (
                <th key={d}
                  className={cn(
                    'text-center py-1 font-normal border-l border-gray-200 w-9',
                    isToday ? 'bg-blue-700 text-white' : isWeekend ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-300'
                  )}
                >
                  <div className="font-semibold">{d}</div>
                  <div className="text-[9px] opacity-70">{DOW[dow]}</div>
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
                const dateStr = `${month}-${String(d).padStart(2, '0')}`
                const booking = cellMap.get(`${room.id}-${dateStr}`)
                const isToday = dateStr === today
                const dow = new Date(dateStr).getDay()
                const isWeekend = dow === 0 || dow === 6

                if (booking) {
                  return (
                    <td key={d}
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
                  <td key={d}
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

type SortKey = 'guestName' | 'roomName' | 'checkIn' | 'checkOut' | 'status' | 'totalAmount' | 'balanceDue'
type SortDir = 'asc' | 'desc'

function SortIcon({ col, sort }: { col: SortKey; sort: { key: SortKey; dir: SortDir } }) {
  if (sort.key !== col) return <ChevronsUpDown size={12} className="inline ml-1 opacity-30" />
  return sort.dir === 'asc'
    ? <ChevronUp size={12} className="inline ml-1 text-gray-900" />
    : <ChevronDown size={12} className="inline ml-1 text-gray-900" />
}

function BookingList({ bookings }: { bookings: Booking[] }) {
  const [sort, setSort]         = useState<{ key: SortKey; dir: SortDir }>({ key: 'checkIn', dir: 'asc' })
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const allStatuses = Array.from(new Set(bookings.map(b => b.booking.status))).sort()

  const filtered = bookings
    .filter(({ booking, room }) => {
      if (statusFilter !== 'all' && booking.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          booking.guestName.toLowerCase().includes(q) ||
          room.name.toLowerCase().includes(q) ||
          (booking.source ?? '').toLowerCase().includes(q)
        )
      }
      return true
    })
    .sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      switch (sort.key) {
        case 'guestName':   return dir * a.booking.guestName.localeCompare(b.booking.guestName)
        case 'roomName':    return dir * a.room.name.localeCompare(b.room.name, undefined, { numeric: true })
        case 'checkIn':     return dir * a.booking.checkIn.localeCompare(b.booking.checkIn)
        case 'checkOut':    return dir * a.booking.checkOut.localeCompare(b.booking.checkOut)
        case 'status':      return dir * a.booking.status.localeCompare(b.booking.status)
        case 'totalAmount': return dir * (parseFloat(a.booking.totalAmount) - parseFloat(b.booking.totalAmount))
        case 'balanceDue':  return dir * (parseFloat(a.booking.balanceDue) - parseFloat(b.booking.balanceDue))
        default: return 0
      }
    })

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
      <div className="flex items-center gap-3 mb-3 flex-wrap">
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
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <option value="all">All Statuses</option>
          {allStatuses.map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {bookings.length}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No bookings match your filters.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs border-b border-gray-200">
              <tr>
                {th('Guest', 'guestName')}
                {th('Room', 'roomName')}
                {th('Check-in', 'checkIn')}
                {th('Check-out', 'checkOut')}
                {th('Status', 'status')}
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Source</th>
                {th('Total', 'totalAmount', 'right')}
                {th('Balance', 'balanceDue', 'right')}
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(({ booking, room }) => (
                <tr key={booking.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{booking.guestName}</td>
                  <td className="px-4 py-3 text-gray-600">{room.name}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkIn)}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkOut)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[booking.status] ?? 'bg-gray-100')}>
                      {STATUS_LABEL[booking.status] ?? booking.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{booking.source ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-700">R {parseFloat(booking.totalAmount).toFixed(0)}</td>
                  <td className={cn('px-4 py-3 text-right font-medium text-xs', parseFloat(booking.balanceDue) > 0 ? 'text-red-600' : 'text-green-600')}>
                    R {parseFloat(booking.balanceDue).toFixed(0)}
                  </td>
                  <td className="px-3 py-3">
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
      )}
    </div>
  )
}
