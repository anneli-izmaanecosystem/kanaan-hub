'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

type Room = { id: number; name: string; type: string; ratePp: string; rateSolo: string | null; capacity: number }

const STATUS_OPTIONS = [
  { value: 'confirmed',       label: 'Confirmed' },
  { value: 'fully_paid',      label: 'Fully Paid' },
  { value: 'partially_paid',  label: 'Partially Paid' },
  { value: 'unpaid',          label: 'Unpaid' },
  { value: 'quote_sent',      label: 'Quote Sent' },
  { value: 'pending',         label: 'Pending' },
  { value: 'cancelled',       label: 'Cancelled' },
  { value: 'checked_in',      label: 'Checked In' },
  { value: 'checked_out',     label: 'Checked Out' },
]

export default function NewBookingPage() {
  const router = useRouter()
  const [rooms, setRooms] = useState<Room[]>([])
  const [aiText, setAiText]   = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const [form, setForm] = useState({
    roomId: '', guestName: '', contact: '', idNumber: '',
    checkIn: '', checkOut: '', adults: '1', children: '0',
    totalAmount: '', depositPaid: '0',
    status: 'confirmed', source: '', paymentMethod: '', invoiceNumber: '', payDate: '',
    specialRequests: '', notes: '',
  })

  useEffect(() => {
    fetch('/api/rooms').then(r => r.json()).then(setRooms).catch(() => {})
  }, [])

  function set(k: string, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (['roomId', 'checkIn', 'checkOut', 'adults'].includes(k)) {
        const room = rooms.find(r => r.id === parseInt(next.roomId))
        if (room && next.checkIn && next.checkOut) {
          const nights = Math.ceil((new Date(next.checkOut).getTime() - new Date(next.checkIn).getTime()) / 86_400_000)
          if (nights > 0) {
            const adults = parseInt(next.adults) || 1
            const rate   = adults === 1 ? parseFloat(room.rateSolo ?? room.ratePp) : parseFloat(room.ratePp)
            next.totalAmount = String(nights * adults * rate)
          }
        }
      }
      return next
    })
  }

  async function parseWithAI() {
    if (!aiText.trim()) return
    setParsing(true); setError('')
    try {
      const res  = await fetch('/api/ai/parse-booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'AI parsing failed'); setParsing(false); return }

      let roomId = form.roomId
      if (data.roomPreference) {
        const pref = data.roomPreference.toLowerCase()
        const match = rooms.find(r => r.name.toLowerCase().includes(pref) || pref.includes(r.name.toLowerCase().replace('room ', '')))
        if (match) roomId = String(match.id)
      }

      setForm(f => ({
        ...f,
        roomId,
        guestName:       data.guestName       ?? f.guestName,
        contact:         data.contact         ?? f.contact,
        checkIn:         data.checkIn         ?? f.checkIn,
        checkOut:        data.checkOut        ?? f.checkOut,
        adults:          String(data.adults   ?? f.adults),
        children:        String(data.children ?? f.children),
        specialRequests: data.specialRequests ?? f.specialRequests,
        totalAmount:     data.estimatedTotal  ? String(data.estimatedTotal) : f.totalAmount,
      }))
    } catch { setError('Network error — could not reach AI') }
    setParsing(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, roomId: parseInt(form.roomId) }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed'); setSaving(false); return }
      router.push('/dashboard/bookings')
    } catch { setError('Network error'); setSaving(false) }
  }

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const label = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">New Booking</h1>

      {/* AI Quick-add */}
      <div className="mb-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1"><Sparkles size={12} /> AI Quick-Add — describe the booking in plain text</p>
        <div className="flex gap-2">
          <textarea
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
            rows={2}
            placeholder="e.g. John Smith 082-555-1234, Room 3, 2 adults, 15 June to 18 June"
            value={aiText}
            onChange={e => setAiText(e.target.value)}
          />
          <button onClick={parseWithAI} disabled={parsing || !aiText.trim()} className="self-end rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {parsing ? '…' : 'Parse'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Room + Adults */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Room *</label>
            <select className={input} value={form.roomId} onChange={e => set('roomId', e.target.value)} required>
              <option value="">Select room</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name} — {r.type}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Adults *</label>
            <input type="number" min={1} className={input} value={form.adults} onChange={e => set('adults', e.target.value)} required />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Check-in *</label>
            <input type="date" className={input} value={form.checkIn} onChange={e => set('checkIn', e.target.value)} required />
          </div>
          <div>
            <label className={label}>Check-out *</label>
            <input type="date" className={input} value={form.checkOut} onChange={e => set('checkOut', e.target.value)} required />
          </div>
        </div>

        {/* Guest */}
        <div>
          <label className={label}>Guest Name *</label>
          <input className={input} value={form.guestName} onChange={e => set('guestName', e.target.value)} required />
        </div>
        <div>
          <label className={label}>Contact (phone / email) *</label>
          <input className={input} value={form.contact} onChange={e => set('contact', e.target.value)} required />
        </div>

        {/* Status + Source */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Status</label>
            <select className={input} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Source</label>
            <select className={input} value={form.source} onChange={e => set('source', e.target.value)}>
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
            <label className={label}>Payment Method</label>
            <select className={input} value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
              <option value="">— Select —</option>
              <option value="Card">Card</option>
              <option value="Cash">Cash</option>
              <option value="EFT">EFT</option>
              <option value="Online">Online</option>
            </select>
          </div>
          <div>
            <label className={label}>Payment Date</label>
            <input type="date" className={input} value={form.payDate} onChange={e => set('payDate', e.target.value)} />
          </div>
        </div>

        {/* Invoice + Amounts */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={label}>Invoice #</label>
            <input className={input} value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} />
          </div>
          <div>
            <label className={label}>Total Amount (R) *</label>
            <input type="number" step="0.01" className={input} value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} required />
          </div>
          <div>
            <label className={label}>Deposit Paid (R)</label>
            <input type="number" step="0.01" className={input} value={form.depositPaid} onChange={e => set('depositPaid', e.target.value)} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={label}>Special Requests</label>
          <textarea className={input} rows={2} value={form.specialRequests} onChange={e => set('specialRequests', e.target.value)} />
        </div>
        <div>
          <label className={label}>Internal Notes</label>
          <textarea className={input} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Booking'}
          </button>
        </div>
      </form>
    </div>
  )
}
