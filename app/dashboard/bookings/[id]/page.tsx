'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Room = { id: number; name: string; type: string; ratePp: string; rateSolo: string | null }

const STATUS_OPTIONS = [
  { value: 'confirmed',      label: 'Confirmed' },
  { value: 'fully_paid',     label: 'Fully Paid' },
  { value: 'partially_paid', label: 'Partially Paid' },
  { value: 'unpaid',         label: 'Unpaid' },
  { value: 'quote_sent',     label: 'Quote Sent' },
  { value: 'pending',        label: 'Pending' },
  { value: 'checked_in',     label: 'Checked In' },
  { value: 'checked_out',    label: 'Checked Out' },
  { value: 'cancelled',      label: 'Cancelled' },
]

export default function BookingDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [rooms, setRooms]       = useState<Room[]>([])
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState('')
  const [loaded, setLoaded]     = useState(false)

  const [form, setForm] = useState({
    roomId: '', guestName: '', contact: '', idNumber: '',
    checkIn: '', checkOut: '', adults: '1', children: '0',
    totalAmount: '', depositPaid: '0', balanceDue: '0',
    status: 'confirmed', source: '', paymentMethod: '', invoiceNumber: '', payDate: '',
    specialRequests: '', notes: '',
  })

  useEffect(() => {
    Promise.all([
      fetch(`/api/bookings/${id}`).then(r => r.json()),
      fetch('/api/rooms').then(r => r.json()),
    ]).then(([b, r]) => {
      setRooms(Array.isArray(r) ? r : [])
      if (b?.id) {
        setForm({
          roomId:          String(b.roomId        ?? ''),
          guestName:       b.guestName            ?? '',
          contact:         b.contact              ?? '',
          idNumber:        b.idNumber             ?? '',
          checkIn:         b.checkIn              ?? '',
          checkOut:        b.checkOut             ?? '',
          adults:          String(b.adults        ?? 1),
          children:        String(b.children      ?? 0),
          totalAmount:     b.totalAmount          ?? '',
          depositPaid:     b.depositPaid          ?? '0',
          balanceDue:      b.balanceDue           ?? '0',
          status:          b.status               ?? 'confirmed',
          source:          b.source               ?? '',
          paymentMethod:   b.paymentMethod        ?? '',
          invoiceNumber:   b.invoiceNumber        ?? '',
          payDate:         b.payDate              ?? '',
          specialRequests: b.specialRequests      ?? '',
          notes:           b.notes               ?? '',
        })
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [id])

  function set(k: string, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'totalAmount' || k === 'depositPaid') {
        const total   = parseFloat(next.totalAmount)  || 0
        const deposit = parseFloat(next.depositPaid)  || 0
        next.balanceDue = String(Math.max(0, total - deposit))
      }
      if (['roomId', 'checkIn', 'checkOut', 'adults'].includes(k)) {
        const room = rooms.find(r => r.id === parseInt(next.roomId))
        if (room && next.checkIn && next.checkOut) {
          const nights = Math.ceil((new Date(next.checkOut).getTime() - new Date(next.checkIn).getTime()) / 86_400_000)
          if (nights > 0) {
            const adults = parseInt(next.adults) || 1
            const rate   = adults === 1 ? parseFloat(room.rateSolo ?? room.ratePp) : parseFloat(room.ratePp)
            next.totalAmount = String(nights * adults * rate)
            next.balanceDue  = String(Math.max(0, nights * adults * rate - (parseFloat(next.depositPaid) || 0)))
          }
        }
      }
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.guestName.trim()) { setError('Guest name is required'); return }
    if (!form.checkIn)          { setError('Check-in date is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          roomId:   form.roomId   ? parseInt(form.roomId)   : undefined,
          adults:   parseInt(form.adults)   || 1,
          children: parseInt(form.children) || 0,
          contact:  form.contact || form.guestName,
          nights:   form.checkIn && form.checkOut
            ? Math.ceil((new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86_400_000)
            : undefined,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to save'); setSaving(false); return }
      router.push('/dashboard/bookings')
    } catch { setError('Network error'); setSaving(false) }
  }

  async function handleCancelBooking() {
    if (!confirm('Mark this booking as cancelled?')) return
    setDeleting(true)
    await fetch(`/api/bookings/${id}`, { method: 'DELETE' })
    router.push('/dashboard/bookings')
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  if (!loaded) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="rounded-lg p-1.5 hover:bg-gray-100 text-gray-500">
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-2xl font-semibold text-gray-900">Edit Booking</h1>
        <span className="ml-auto text-xs text-gray-400">#{id}</span>
      </div>

      <form onSubmit={handleSave} className="space-y-4">

        {/* Required */}
        <div>
          <label className={lbl}>Guest Name *</label>
          <input className={inp} value={form.guestName} onChange={e => set('guestName', e.target.value)} required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Check-in *</label>
            <input type="date" className={inp} value={form.checkIn} onChange={e => set('checkIn', e.target.value)} required />
          </div>
          <div>
            <label className={lbl}>Check-out</label>
            <input type="date" className={inp} value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
          </div>
        </div>

        {/* Room + Adults */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Room</label>
            <select className={inp} value={form.roomId} onChange={e => set('roomId', e.target.value)}>
              <option value="">— Select room —</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name} — {r.type}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Adults</label>
              <input type="number" min={0} className={inp} value={form.adults} onChange={e => set('adults', e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Children</label>
              <input type="number" min={0} className={inp} value={form.children} onChange={e => set('children', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div>
          <label className={lbl}>Contact (phone / email)</label>
          <input className={inp} value={form.contact} onChange={e => set('contact', e.target.value)} />
        </div>

        {/* Status + Source */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Status</label>
            <select className={inp} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Source</label>
            <select className={inp} value={form.source} onChange={e => set('source', e.target.value)}>
              <option value="">— Select —</option>
              <option value="Walk-in">Walk-in</option>
              <option value="Online">Online</option>
              <option value="Booking Site">Booking Site</option>
              <option value="Direct">Direct</option>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Phone">Phone</option>
            </select>
          </div>
        </div>

        {/* Payment */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Payment Method</label>
            <select className={inp} value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
              <option value="">— Select —</option>
              <option value="Card">Card</option>
              <option value="Cash">Cash</option>
              <option value="EFT">EFT</option>
              <option value="Online">Online</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Payment Date</label>
            <input type="date" className={inp} value={form.payDate} onChange={e => set('payDate', e.target.value)} />
          </div>
        </div>

        {/* Invoice + Amounts */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Invoice #</label>
            <input className={inp} value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Total (R)</label>
            <input type="number" step="0.01" className={inp} value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Deposit Paid (R)</label>
            <input type="number" step="0.01" className={inp} value={form.depositPaid} onChange={e => set('depositPaid', e.target.value)} />
          </div>
        </div>

        {/* Balance indicator */}
        {form.totalAmount && (
          <div className={cn(
            'rounded-lg px-4 py-3 text-sm font-medium flex items-center justify-between',
            parseFloat(form.balanceDue) > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          )}>
            <span>Balance Due</span>
            <span>R {parseFloat(form.balanceDue || '0').toFixed(2)}</span>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className={lbl}>Special Requests</label>
          <textarea className={inp} rows={2} value={form.specialRequests} onChange={e => set('specialRequests', e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Internal Notes</label>
          <textarea className={inp} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Back
          </button>
          <button type="submit" disabled={saving}
            className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button type="button" onClick={handleCancelBooking} disabled={deleting}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={14} /> {deleting ? 'Cancelling…' : 'Cancel Booking'}
          </button>
        </div>
      </form>
    </div>
  )
}
