'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Pencil, X } from 'lucide-react'
import { fmtDate } from '@/lib/utils'
import { todaySA } from '@/lib/date-sa'
import { isBookingIncomplete, missingBookingFields, FIELD_LABELS } from '@/lib/booking-completeness'

// Persisted across reloads/navigation so the filter stays applied until the user
// explicitly clears it — matches the "leave filter intact until cleared" behavior.
const MONTH_FILTER_KEY = 'kanaan-hub:actions-month-filter'

function monthLabel(ym: string) {
  // Construct from local-time components (not `new Date(ym + '-01')`, which parses as
  // UTC midnight) so viewers west of UTC don't see the label roll back a month.
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
}

type Room = { id: number; name: string }
type Booking = {
  booking: {
    id: number; guestName: string; checkIn: string; checkOut: string
    status: string; paymentMethod: string | null; source: string | null; invoiceNumber: string | null
  }
  rooms: Room[]
}

export default function ActionsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading]   = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/bookings', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setBookings(Array.isArray(b) ? b : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Restore a previously-set month filter on load; stays applied across reloads
  // and navigation until the user clicks Clear.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MONTH_FILTER_KEY)
      if (saved) setSelectedMonth(saved)
    } catch {}
  }, [])

  function selectMonth(m: string) {
    setSelectedMonth(m)
    try { localStorage.setItem(MONTH_FILTER_KEY, m) } catch {}
  }

  function clearMonthFilter() {
    setSelectedMonth(null)
    try { localStorage.removeItem(MONTH_FILTER_KEY) } catch {}
  }

  const today = todaySA()
  const allFlagged = bookings
    .filter(({ booking }) => isBookingIncomplete(booking, today))
    .sort((a, b) => a.booking.checkOut.localeCompare(b.booking.checkOut))

  const months = Array.from(new Set(allFlagged.map(({ booking }) => booking.checkOut.slice(0, 7))))
    .sort((a, b) => b.localeCompare(a))

  const flagged = selectedMonth
    ? allFlagged.filter(({ booking }) => booking.checkOut.slice(0, 7) === selectedMonth)
    : allFlagged

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">Actions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Bookings that ended 2+ days ago and are still missing payment method, source, or an invoice.
        </p>
      </div>

      {months.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-5">
          {months.map(m => (
            <button
              key={m}
              onClick={() => selectMonth(m)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                m === selectedMonth
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {monthLabel(m)}
            </button>
          ))}
          {selectedMonth && (
            <button
              onClick={clearMonthFilter}
              className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          {selectedMonth ? `Nothing needs attention for ${monthLabel(selectedMonth)}.` : 'Nothing needs attention — all caught up.'}
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Guest</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Room</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Check-out</th>
                <th className="px-4 py-3 text-left text-gray-500 font-medium">Missing</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {flagged.map(({ booking, rooms }) => (
                <tr key={booking.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{booking.guestName}</td>
                  <td className="px-4 py-3 text-gray-600">{rooms.map(r => r.name).join(', ')}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(booking.checkOut)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {missingBookingFields(booking).map(f => (
                        <span key={f} className="rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700">
                          {FIELD_LABELS[f]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/dashboard/bookings/${booking.id}`}
                      className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap w-fit">
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
