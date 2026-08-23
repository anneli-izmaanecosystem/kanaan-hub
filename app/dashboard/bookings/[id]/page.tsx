'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ChevronLeft, Trash2, AlertTriangle } from 'lucide-react'
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

export default function BookingDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()

  const [rooms, setRooms]       = useState<Room[]>([])
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState('')
  const [loaded, setLoaded]     = useState(false)

  const [form, setForm] = useState({
    roomIds: [] as string[], guestName: '', contact: '', idNumber: '',
    checkIn: '', checkOut: '', adults: '1', children: '0',
    totalAmount: '', depositPaid: '0', balanceDue: '0',
    status: 'unpaid_quoted', source: '', sourceOther: '', paymentMethod: '', invoiceNumber: '', payDate: '',
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
          roomIds:         Array.isArray(b.roomIds) ? b.roomIds.map(String) : (b.roomId ? [String(b.roomId)] : []),
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
          status:          b.status               ?? 'unpaid_quoted',
          source:          b.source               ?? '',
          sourceOther:     b.sourceOther           ?? '',
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
      return next
    })
  }

  function toggleRoom(id: number) {
    setForm(f => {
      const idStr = String(id)
      const roomIds = f.roomIds.includes(idStr) ? f.roomIds.filter(r => r !== idStr) : [...f.roomIds, idStr]
      return { ...f, roomIds }
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.guestName.trim()) { setError('Guest name is required'); return }
    if (!form.checkIn)          { setError('Check-in date is required'); return }
    if (form.roomIds.length === 0) { setError('At least one room is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          roomIds:     form.roomIds.map(rid => parseInt(rid)),
          adults:      parseInt(form.adults)   || 1,
          children:    parseInt(form.children) || 0,
          contact:     form.contact || form.guestName,
          sourceOther: form.source === 'other' ? form.sourceOther : null,
          nights:   form.checkIn && form.checkOut
            ? Math.ceil((new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86_400_000)
            : undefined,
        }),
      })
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Failed to save'); setSaving(false); return }
      router.back() // returns to the bookings list at whatever view/window it was showing
    } catch { setError('Network error'); setSaving(false) }
  }

  async function handleCancelBooking() {
    if (!confirm('Mark this booking as cancelled?')) return
    setDeleting(true)
    await fetch(`/api/bookings/${id}`, { method: 'DELETE' })
    router.back() // returns to the bookings list at whatever view/window it was showing
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  if (!loaded) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  const selectedRooms = form.roomIds.map(rid => rooms.find(r => r.id === parseInt(rid))).filter(Boolean) as Room[]
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

        {/* Rooms + Adults */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Rooms {selectedRooms.length > 1 && <span className="text-gray-400 font-normal">({selectedRooms.length} selected)</span>}</label>
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

        {selectedRooms.length > 0 && (
          <p className="-mt-2 text-[11px] text-gray-400">Combined capacity: {combinedCapacity} pax</p>
        )}

        {underMin && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{selectedRooms[0].name} normally isn't booked below {minOccupancy(selectedRooms[0].capacity)} pax (capacity {selectedRooms[0].capacity}) — override only if the front desk has agreed to it.</span>
          </div>
        )}

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
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {form.source === 'other' && (
              <input
                className={cn(inp, 'mt-2')}
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
            <input
              className={inp}
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
            <label className={lbl}>Total (R)</label>
            <input type="number" step="0.01" inputMode="decimal" onFocus={e => e.target.select()} className={inp} value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Deposit Paid (R)</label>
            <input type="number" step="0.01" inputMode="decimal" onFocus={e => e.target.select()} className={inp} value={form.depositPaid} onChange={e => set('depositPaid', e.target.value)} />
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
