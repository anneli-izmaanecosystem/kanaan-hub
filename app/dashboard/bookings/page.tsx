'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, CalendarDays, List, ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtDate, cn } from '@/lib/utils'

type Booking = {
  booking: {
    id: number; guestName: string; checkIn: string; checkOut: string
    status: string; adults: number; totalAmount: string; balanceDue: string
  }
  room: { id: number; name: string; type: string }
}

const STATUS_COLORS: Record<string, string> = {
  confirmed:   'bg-green-100 text-green-800',
  pending:     'bg-yellow-100 text-yellow-800',
  checked_in:  'bg-blue-100 text-blue-800',
  checked_out: 'bg-gray-100 text-gray-700',
  cancelled:   'bg-red-100 text-red-700',
}

export default function BookingsPage() {
  const [view, setView]       = useState<'list' | 'calendar'>('list')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(() => new Date().toISOString().slice(0, 7))

  useEffect(() => {
    setLoading(true)
    fetch(`/api/bookings?month=${month}`)
      .then(r => r.json())
      .then(data => { setBookings(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [month])

  function prevMonth() {
    const d = new Date(month + '-01')
    d.setMonth(d.getMonth() - 1)
    setMonth(d.toISOString().slice(0, 7))
  }
  function nextMonth() {
    const d = new Date(month + '-01')
    d.setMonth(d.getMonth() + 1)
    setMonth(d.toISOString().slice(0, 7))
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Bookings</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setView('list')} className={cn('px-3 py-1.5 text-sm', view === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50')}>
              <List size={16} />
            </button>
            <button onClick={() => setView('calendar')} className={cn('px-3 py-1.5 text-sm', view === 'calendar' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50')}>
              <CalendarDays size={16} />
            </button>
          </div>
          <Link href="/dashboard/bookings/new" className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Plus size={16} /> New Booking
          </Link>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={prevMonth} className="rounded-md p-1 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <span className="text-sm font-medium text-gray-700 w-32 text-center">
          {new Date(month + '-01').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}
        </span>
        <button onClick={nextMonth} className="rounded-md p-1 hover:bg-gray-100"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : view === 'list' ? (
        <BookingList bookings={bookings} />
      ) : (
        <BookingCalendarView bookings={bookings} month={month} />
      )}
    </div>
  )
}

function BookingList({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) return <p className="text-sm text-gray-400">No bookings for this period.</p>
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Guest</th>
            <th className="px-4 py-3 text-left">Room</th>
            <th className="px-4 py-3 text-left">Check-in</th>
            <th className="px-4 py-3 text-left">Check-out</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.map(({ booking, room }) => (
            <tr key={booking.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium text-gray-900">
                <Link href={`/dashboard/bookings/${booking.id}`} className="hover:underline">{booking.guestName}</Link>
              </td>
              <td className="px-4 py-3 text-gray-600">{room.name}</td>
              <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkIn)}</td>
              <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkOut)}</td>
              <td className="px-4 py-3">
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_COLORS[booking.status] ?? 'bg-gray-100')}>{booking.status}</span>
              </td>
              <td className="px-4 py-3 text-right text-gray-700">R {parseFloat(booking.totalAmount).toFixed(2)}</td>
              <td className={cn('px-4 py-3 text-right font-medium', parseFloat(booking.balanceDue) > 0 ? 'text-red-600' : 'text-green-600')}>
                R {parseFloat(booking.balanceDue).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BookingCalendarView({ bookings, month }: { bookings: Booking[]; month: string }) {
  const firstDay = new Date(month + '-01')
  const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate()
  const startDow = firstDay.getDay()

  const nullCells: (number | null)[] = Array.from({ length: startDow }, () => null)
  const dayCells: (number | null)[]  = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const cells = [...nullCells, ...dayCells]

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} className="text-center text-xs text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const dateStr = `${month}-${String(day).padStart(2, '0')}`
          const dayBookings = bookings.filter(b =>
            b.booking.checkIn <= dateStr && b.booking.checkOut > dateStr
          )
          const isToday = dateStr === new Date().toISOString().split('T')[0]
          return (
            <div key={i} className={cn('min-h-16 rounded-lg border p-1', isToday ? 'border-blue-400 bg-blue-50' : 'border-gray-100')}>
              <p className={cn('text-xs font-medium mb-1', isToday ? 'text-blue-700' : 'text-gray-500')}>{day}</p>
              {dayBookings.slice(0, 2).map(({ booking, room }) => (
                <Link key={booking.id} href={`/dashboard/bookings/${booking.id}`}
                  className="block truncate rounded bg-green-100 px-1 text-[10px] text-green-800 mb-0.5 hover:bg-green-200">
                  {room.name} · {booking.guestName.split(' ')[0]}
                </Link>
              ))}
              {dayBookings.length > 2 && (
                <p className="text-[10px] text-gray-400">+{dayBookings.length - 2} more</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
