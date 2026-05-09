'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { fmt, fmtDate, cn } from '@/lib/utils'
import { Trash2 } from 'lucide-react'

type Booking = {
  id: number; roomId: number; guestName: string; contact: string; idNumber: string | null
  checkIn: string; checkOut: string; adults: number; children: number; nights: number
  totalAmount: string; depositPaid: string; balanceDue: string
  specialRequests: string | null; status: string; source: string | null; notes: string | null
}

const STATUSES = ['confirmed','pending','checked_in','checked_out','cancelled']

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    fetch(`/api/bookings/${id}`).then(r => r.json()).then(d => { setBooking(d); setLoading(false) })
  }, [id])

  async function update(patch: Partial<Booking>) {
    setSaving(true)
    const res = await fetch(`/api/bookings/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (res.ok) setBooking(await res.json())
    setSaving(false)
  }

  async function cancel() {
    if (!confirm('Cancel this booking?')) return
    await fetch(`/api/bookings/${id}`, { method: 'DELETE' })
    router.push('/dashboard/bookings')
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!booking) return <div className="p-8 text-sm text-red-500">Booking not found.</div>

  const row = 'flex items-start gap-4 py-3 border-b border-gray-100 last:border-0'
  const key = 'w-36 shrink-0 text-xs text-gray-500'
  const val = 'text-sm text-gray-900'

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Booking #{booking.id}</h1>
        <button onClick={cancel} className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800">
          <Trash2 size={14} /> Cancel Booking
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 space-y-1">
        <div className={row}>
          <span className={key}>Status</span>
          <select
            className="text-sm border border-gray-200 rounded-md px-2 py-1"
            value={booking.status}
            onChange={e => { setBooking(b => b ? {...b, status: e.target.value} : b); update({ status: e.target.value as any }) }}
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className={row}><span className={key}>Guest</span><span className={val}>{booking.guestName}</span></div>
        <div className={row}><span className={key}>Contact</span><span className={val}>{booking.contact}</span></div>
        {booking.idNumber && <div className={row}><span className={key}>ID Number</span><span className={val}>{booking.idNumber}</span></div>}
        <div className={row}><span className={key}>Room</span><span className={val}>Room {booking.roomId}</span></div>
        <div className={row}><span className={key}>Check-in</span><span className={val}>{fmtDate(booking.checkIn)}</span></div>
        <div className={row}><span className={key}>Check-out</span><span className={val}>{fmtDate(booking.checkOut)}</span></div>
        <div className={row}><span className={key}>Nights</span><span className={val}>{booking.nights}</span></div>
        <div className={row}><span className={key}>Adults</span><span className={val}>{booking.adults}</span></div>
        <div className={row}><span className={key}>Total</span><span className={val}>{fmt(booking.totalAmount)}</span></div>
        <div className={row}><span className={key}>Deposit</span><span className={val}>{fmt(booking.depositPaid)}</span></div>
        <div className={row}>
          <span className={key}>Balance Due</span>
          <span className={cn(val, parseFloat(booking.balanceDue) > 0 ? 'text-red-600 font-semibold' : 'text-green-600')}>
            {fmt(booking.balanceDue)}
          </span>
        </div>
        {booking.specialRequests && <div className={row}><span className={key}>Special Requests</span><span className={val}>{booking.specialRequests}</span></div>}
      </div>

      <div className="mt-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Deposit Paid (R)</label>
        <div className="flex gap-2">
          <input
            type="number" step="0.01"
            defaultValue={booking.depositPaid}
            className="w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            onBlur={e => {
              const dp = parseFloat(e.target.value)
              update({ depositPaid: String(dp), balanceDue: String(parseFloat(booking.totalAmount) - dp) })
            }}
          />
          <span className="self-center text-xs text-gray-400">{saving ? 'Saving…' : 'Auto-saved on blur'}</span>
        </div>
      </div>
    </div>
  )
}
