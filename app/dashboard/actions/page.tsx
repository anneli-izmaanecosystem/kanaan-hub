'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { fmtDate } from '@/lib/utils'
import { todaySA } from '@/lib/date-sa'
import { isBookingIncomplete, missingBookingFields, FIELD_LABELS } from '@/lib/booking-completeness'

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

  useEffect(() => {
    fetch('/api/bookings', { cache: 'no-store' })
      .then(r => r.json())
      .then(b => setBookings(Array.isArray(b) ? b : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const today = todaySA()
  const flagged = bookings
    .filter(({ booking }) => isBookingIncomplete(booking, today))
    .sort((a, b) => a.booking.checkOut.localeCompare(b.booking.checkOut))

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-gray-900">Actions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Bookings that ended 2+ days ago and are still missing payment method, source, or an invoice.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Nothing needs attention — all caught up.</p>
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
