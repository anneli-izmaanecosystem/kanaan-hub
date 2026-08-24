'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { minOccupancy } from '@/lib/pricing'

type Room = {
  id: number; name: string; type: string; ratePp: string; rateSolo: string | null
  capacity: number; pricingMode: 'flat' | 'per_pax'
}

// Sentinel stored in invoiceNumber when explicitly marked "No Invoice" — distinct from a
// blank/unset field, which just means nobody has decided yet. Only this value renders
// as #N/A on the bookings List view.
const NO_INVOICE = 'N/A'

const STATUS_OPTIONS = [
  { value: 'unpaid_quoted', label: 'Unpaid / Quoted' },
  { value: 'deposit_paid',  label: 'Deposit Paid' },
  { value: 'fully_paid',    label: 'Fully Paid' },
  { value: 'booking_site',  label: 'Booking Site' },
  { value: 'cancelled',     label: 'Cancelled' },
]

const SOURCE_OPTIONS = [
  { value: 'direct_walkin', label: 'Direct/Walk-in' },
  { value: 'booking_com',   label: 'Booking.com' },
  { value: 'lekkaslaap',    label: 'Lekkaslaap' },
  { value: 'other',         label: 'Other' },
]

export default function NewBookingPage() {
  const router = useRouter()
  const [rooms, setRooms]   = useState<Room[]>([])
  const [aiText, setAiText]   = useState('')
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const [form, setForm] = useState({
    roomIds: [] as string[], guestName: '', contact: '', idNumber: '',
    checkIn: '', checkOut: '', adults: '1', children: '0',
    totalAmount: '', depositPaid: '0', vatIncluded: true, commissionAmount: '',
    status: 'unpaid_quoted', source: '', sourceOther: '', paymentMethod: '', invoiceNumber: '', payDate: '',
    specialRequests: '', notes: '',
  })

  useEffect(() => {
    fetch('/api/rooms').then(r => r.json()).then(r => setRooms(Array.isArray(r) ? r : [])).catch(() => {})
  }, [])

  function set(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function toggleRoom(id: number) {
    setForm(f => {
      const idStr = String(id)
      const roomIds = f.roomIds.includes(idStr) ? f.roomIds.filter(r => r !== idStr) : [...f.roomIds, idStr]
      return { ...f, roomIds }
    })
  }

  async function parseWithAI() {
    if (!aiText.trim()) return
    setParsing(true); setError('')
    try {
      const res  = await fetch('/api/ai/parse-booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiText }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'AI parsing failed'); setParsing(false); return }

      let roomIds = form.roomIds
      if (data.roomPreference) {
        const pref = data.roomPreference.toLowerCase()
        const match = rooms.find(r => r.name.toLowerCase().includes(pref) || pref.includes(r.name.toLowerCase().replace('room ', '')))
        if (match) roomIds = [String(match.id)]
      }

      setForm(f => ({
        ...f,
        roomIds,
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
    if (form.roomIds.length === 0) { setError('At least one room is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          roomIds: form.roomIds.map(id => parseInt(id)),
          sourceOther: form.source === 'other' ? form.sourceOther : null,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed'); setSaving(false); return }
      router.back() // returns to the bookings list at whatever view/window it was showing
    } catch { setError('Network error'); setSaving(false) }
  }

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const label = 'block text-xs font-medium text-gray-600 mb-1'

  const selectedRooms = form.roomIds.map(id => rooms.find(r => r.id === parseInt(id))).filter(Boolean) as Room[]
  const adults = parseInt(form.adults) || 1
  const combinedCapacity = selectedRooms.reduce((s, r) => s + r.capacity, 0)
  const underMin = selectedRooms.length === 1 && adults < minOccupancy(selectedRooms[0].capacity)

  const roomGroups: { label: string; filter: (r: Room) => boolean }[] = [
    { label: 'Lodge',       filter: (r: Room) => r.type === 'premium' || r.type === 'budget' },
    { label: 'Backpackers', filter: (r: Room) => r.type === 'dorm' },
    { label: 'Camping',     filter: (r: Room) => r.type === 'camping' },
  ]

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
        {/* Rooms + Adults */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Rooms {selectedRooms.length > 1 && <span className="text-gray-400 font-normal">({selectedRooms.length} selected)</span>}</label>
            <div className="rounded-lg border border-gray-200 p-2 max-h-40 overflow-y-auto space-y-2">
              {roomGroups.map(({ label: groupLabel, filter }) => {
                const group = rooms.filter(filter)
                if (group.length === 0) return null
                return (
                  <div key={groupLabel}>
                    <p className="text-[10px] font-semibold uppercase text-gray-400 mb-1">{groupLabel}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.map(r => (
                        <button type="button" key={r.id} onClick={() => toggleRoom(r.id)}
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-xs border transition-colors leading-tight',
                            form.roomIds.includes(String(r.id))
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                          )}>
                          <div>{r.name}</div>
                          <div className="text-[9px] opacity-70">R{r.ratePp}/pp{r.rateSolo ? ` · R${r.rateSolo} solo` : ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <label className={label}>Adults *</label>
            <input type="number" min={1} className={input} value={form.adults} onChange={e => set('adults', e.target.value)} required />
            {selectedRooms.length > 0 && (
              <p className="mt-1 text-[11px] text-gray-400">Combined capacity: {combinedCapacity} pax</p>
            )}
          </div>
        </div>

        {underMin && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{selectedRooms[0].name} normally isn't booked below {minOccupancy(selectedRooms[0].capacity)} pax (capacity {selectedRooms[0].capacity}) — override only if the front desk has agreed to it.</span>
          </div>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Check-in *</label>
            <input type="date" className={input} value={form.checkIn} onChange={e => set('checkIn', e.target.value)} required />
          </div>
          <div>
            <label className={label}>Check-out</label>
            <input type="date" className={input} value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
          </div>
        </div>

        {/* Guest */}
        <div>
          <label className={label}>Guest Name *</label>
          <input className={input} value={form.guestName} onChange={e => set('guestName', e.target.value)} required />
        </div>
        <div>
          <label className={label}>Contact (phone / email)</label>
          <input className={input} value={form.contact} onChange={e => set('contact', e.target.value)} />
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
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {form.source === 'other' && (
              <input
                className={cn(input, 'mt-2')}
                placeholder="Describe the source"
                value={form.sourceOther}
                onChange={e => set('sourceOther', e.target.value)}
              />
            )}
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
            <input
              className={input}
              value={form.invoiceNumber === NO_INVOICE ? '' : form.invoiceNumber}
              onChange={e => set('invoiceNumber', e.target.value)}
              disabled={form.invoiceNumber === NO_INVOICE}
              placeholder={form.invoiceNumber === NO_INVOICE ? 'No Invoice' : ''}
            />
            <label className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={form.invoiceNumber === NO_INVOICE}
                onChange={e => set('invoiceNumber', e.target.checked ? NO_INVOICE : '')}
              />
              No Invoice
            </label>
          </div>
          <div>
            <label className={label}>Total Amount (R) *</label>
            <input type="number" step="0.01" inputMode="decimal" onFocus={e => e.target.select()} className={input} value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} />
          </div>
          <div>
            <label className={label}>Deposit Paid (R)</label>
            <input type="number" step="0.01" inputMode="decimal" onFocus={e => e.target.select()} className={input} value={form.depositPaid} onChange={e => set('depositPaid', e.target.value)} />
          </div>
        </div>

        {/* VAT + Commission */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mt-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <input
                type="checkbox"
                checked={form.vatIncluded}
                onChange={e => setForm(f => ({ ...f, vatIncluded: e.target.checked }))}
              />
              Amount Includes VAT
            </label>
          </div>
          <div>
            <label className={label}>Commission (R) <span className="text-gray-400 font-normal">— booking sites</span></label>
            <input type="number" step="0.01" inputMode="decimal" onFocus={e => e.target.select()} className={input} value={form.commissionAmount} onChange={e => set('commissionAmount', e.target.value)} />
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
