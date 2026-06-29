'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle, Info, Truck, Clock, ChevronRight, Plus, ReceiptText, Pencil } from 'lucide-react'
import { cn, fmt, fmtDate } from '@/lib/utils'

type Allocation = {
  id: number
  fillId: number
  dayId: number | null
  allocType: 'onsite' | 'offsite'
  clientName: string | null
  hoursWorked: string | null
  litres: string
  cost: string
}

type Fill = {
  id: number
  fillDate: string
  driverName: string
  vehicle: string
  openReading: string | null
  closeReading: string | null
  litres: string
  isEstimated: boolean
  ratePerLitre: string
  flag: 'ok' | 'estimated' | 'delivery' | 'shortage'
  status: 'draft' | 'final'
  notes: string | null
  allocations: Allocation[]
}

const FLAG_ICON = {
  ok:       <CheckCircle size={14} className="text-green-500" />,
  estimated:<AlertTriangle size={14} className="text-amber-500" />,
  delivery: <Info size={14} className="text-blue-500" />,
  shortage: <AlertTriangle size={14} className="text-red-500" />,
}

const FLAG_LABEL = {
  ok:       'OK',
  estimated:'Estimated',
  delivery: 'Delivery',
  shortage: 'Shortage',
}

const FLAG_BADGE: Record<string, string> = {
  ok:       'bg-green-50 text-green-700',
  estimated:'bg-amber-50 text-amber-700',
  delivery: 'bg-blue-50 text-blue-700',
  shortage: 'bg-red-50 text-red-700',
}

export default function FuelReconPage() {
  const [fills, setFills]   = useState<Fill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/fuel-fills').then(r => r.json()).then(d => {
      setFills(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const drafts  = fills.filter(f => f.status === 'draft')
  const finals  = fills.filter(f => f.status === 'final')

  const totalLitres  = finals.reduce((s, f) => s + parseFloat(f.litres), 0)
  const totalCost    = finals.reduce((s, f) => s + f.allocations.reduce((a, al) => a + parseFloat(al.cost), 0), 0)
  const offsiteLitres= finals.reduce((s, f) => s + f.allocations.filter(a => a.allocType === 'offsite').reduce((a, al) => a + parseFloat(al.litres), 0), 0)
  const offsiteCost  = finals.reduce((s, f) => s + f.allocations.filter(a => a.allocType === 'offsite').reduce((a, al) => a + parseFloat(al.cost), 0), 0)
  const flagCount    = finals.filter(f => f.flag !== 'ok' && f.flag !== 'delivery').length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Fuel Log</h1>
          <p className="text-sm text-gray-400 mt-0.5">Kanaan Guest Farm — Tank Flow Meter</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/fuel/purchases"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Truck size={15} /> Fuel Purchases
          </Link>
          <Link href="/dashboard/fuel/alpheus"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Clock size={15} /> Alpheus Days
          </Link>
          <Link href="/dashboard/fuel/offsite"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <ReceiptText size={15} /> Off-site &amp; Invoices
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Litres Used', value: `${totalLitres.toFixed(0)} L`, sub: 'finalised fills' },
          { label: 'Total Cost', value: fmt(totalCost), sub: 'excl VAT' },
          { label: 'Off-site Recoverable', value: fmt(offsiteCost), sub: `${offsiteLitres.toFixed(0)}L from clients` },
          { label: flagCount > 0 ? `${flagCount} Flag${flagCount > 1 ? 's' : ''}` : 'All Clear', value: flagCount > 0 ? '⚠' : '✓', sub: flagCount > 0 ? 'estimated or shortage' : 'no issues', alert: flagCount > 0 },
        ].map(s => (
          <div key={s.label} className={cn('rounded-xl border p-4 bg-white shadow-sm', s.alert ? 'border-amber-200' : 'border-gray-200')}>
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold', s.alert ? 'text-amber-600' : 'text-gray-900')}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Draft queue */}
      {drafts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={15} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">{drafts.length} fill{drafts.length > 1 ? 's' : ''} awaiting allocation</span>
          </div>
          <div className="flex flex-col gap-2">
            {drafts.map(f => (
              <div key={f.id} className="flex items-center justify-between bg-white rounded-lg border border-amber-100 px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-gray-900">{fmtDate(f.fillDate)} — {f.driverName} / {f.vehicle}</span>
                  {f.openReading && f.closeReading && (
                    <span className="ml-2 text-xs text-gray-400">{f.openReading} → {f.closeReading}</span>
                  )}
                  {f.isEstimated && <span className="ml-2 text-xs text-amber-600 font-medium">⚠ Estimated</span>}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-lg font-bold text-blue-700">{parseFloat(f.litres).toFixed(0)} L</span>
                  <AllocateButton fill={f} onDone={updated => setFills(prev => prev.map(x => x.id === updated.fill.id ? { ...updated.fill, allocations: updated.allocations } : x))} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main recon table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Fill History</h2>
          <span className="text-xs text-gray-400">{finals.length} finalised entries</span>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 p-6">Loading…</p>
        ) : finals.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-gray-400 mb-2">No finalised fill entries yet.</p>
            <p className="text-xs text-gray-400">Capture fills from the mobile app — they appear here as drafts to allocate.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Driver</th>
                  <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                  <th className="px-4 py-3 text-right font-medium">Open (L)</th>
                  <th className="px-4 py-3 text-right font-medium">Close (L)</th>
                  <th className="px-4 py-3 text-right font-medium">Litres</th>
                  <th className="px-4 py-3 text-right font-medium">R/L</th>
                  <th className="px-4 py-3 text-left font-medium">Allocation</th>
                  <th className="px-4 py-3 text-right font-medium">Cost (R)</th>
                  <th className="px-4 py-3 text-center font-medium">Flag</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {finals.map(f => {
                  const totalCostRow = f.allocations.reduce((s, a) => s + parseFloat(a.cost), 0)
                  const offsite = f.allocations.filter(a => a.allocType === 'offsite')
                  const onsite  = f.allocations.filter(a => a.allocType === 'onsite')

                  return (
                    <tr key={f.id} className={cn('hover:bg-gray-50', f.flag === 'estimated' && 'bg-amber-50/40', f.flag === 'delivery' && 'bg-blue-50/40')}>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fmtDate(f.fillDate)}</td>
                      <td className="px-4 py-3 text-gray-700">{f.driverName}</td>
                      <td className="px-4 py-3 text-gray-600">{f.vehicle}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{f.openReading ? Number(f.openReading).toLocaleString('en-ZA') : '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{f.closeReading ? Number(f.closeReading).toLocaleString('en-ZA') : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{parseFloat(f.litres).toFixed(0)}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{parseFloat(f.ratePerLitre).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        {f.allocations.length === 0 ? (
                          <span className="text-gray-400 text-xs">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {offsite.map(a => (
                              <span key={a.id} className="inline-flex items-center gap-1 text-xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                <span className="text-blue-700 font-medium">{a.clientName ?? 'Off-site'}</span>
                                <span className="text-gray-400">{parseFloat(a.litres).toFixed(0)}L{a.hoursWorked ? ` · ${a.hoursWorked}hr` : ''}</span>
                              </span>
                            ))}
                            {onsite.map(a => (
                              <span key={a.id} className="inline-flex items-center gap-1 text-xs">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                <span className="text-green-700 font-medium">On-site</span>
                                <span className="text-gray-400">{parseFloat(a.litres).toFixed(0)}L{a.hoursWorked ? ` · ${a.hoursWorked}hr` : ''}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {totalCostRow > 0 ? `R ${totalCostRow.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', FLAG_BADGE[f.flag])}>
                          {FLAG_ICON[f.flag]}
                          {FLAG_LABEL[f.flag]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <EditFillButton fill={f} onDone={updated =>
                          setFills(prev => prev.map(x => x.id === updated.fill.id
                            ? { ...updated.fill, allocations: updated.allocations }
                            : x))
                        } />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 text-xs font-semibold">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-gray-500">TOTALS</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totalLitres.toFixed(0)}</td>
                  <td />
                  <td className="px-4 py-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />{offsiteLitres.toFixed(0)}L recoverable</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">R {totalCost.toFixed(2)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Edit fill modal ──────────────────────────────────────────────────────────

type EditFillForm = {
  fillDate: string
  driverName: string
  vehicle: string
  openReading: string
  closeReading: string
  litres: string
  isEstimated: boolean
  ratePerLitre: string
  flag: Fill['flag']
  notes: string
}

function EditFillButton({ fill, onDone }: { fill: Fill; onDone: (updated: { fill: Fill; allocations: Allocation[] }) => void }) {
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [form, setForm]     = useState<EditFillForm>({
    fillDate:     fill.fillDate,
    driverName:   fill.driverName,
    vehicle:      fill.vehicle,
    openReading:  fill.openReading ?? '',
    closeReading: fill.closeReading ?? '',
    litres:       fill.litres,
    isEstimated:  fill.isEstimated,
    ratePerLitre: fill.ratePerLitre,
    flag:         fill.flag,
    notes:        fill.notes ?? '',
  })

  function set<K extends keyof EditFillForm>(key: K, val: EditFillForm[K]) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/fuel-fills/${fill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:       'edit-fill',
          fillDate:     form.fillDate,
          driverName:   form.driverName,
          vehicle:      form.vehicle,
          openReading:  form.openReading  ? parseFloat(form.openReading)  : null,
          closeReading: form.closeReading ? parseFloat(form.closeReading) : null,
          litres:       parseFloat(form.litres),
          isEstimated:  form.isEstimated,
          ratePerLitre: parseFloat(form.ratePerLitre),
          flag:         form.flag,
          notes:        form.notes || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error); return }
      const data = await res.json()
      onDone(data)
      setOpen(false)
    } finally { setSaving(false) }
  }

  return (
    <>
      <button
        onClick={() => { setForm({ fillDate: fill.fillDate, driverName: fill.driverName, vehicle: fill.vehicle, openReading: fill.openReading ?? '', closeReading: fill.closeReading ?? '', litres: fill.litres, isEstimated: fill.isEstimated, ratePerLitre: fill.ratePerLitre, flag: fill.flag, notes: fill.notes ?? '' }); setOpen(true) }}
        className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:border-gray-400 hover:text-gray-800"
      >
        <Pencil size={11} /> Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Edit Fill</h3>
                <p className="text-xs text-gray-400">ID #{fill.id} — changes recalculate allocation costs if rate changes</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
            </div>

            <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Date</label>
                  <input type="date" value={form.fillDate} onChange={e => set('fillDate', e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Flag</label>
                  <select value={form.flag} onChange={e => set('flag', e.target.value as Fill['flag'])}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300">
                    <option value="ok">OK</option>
                    <option value="estimated">Estimated</option>
                    <option value="delivery">Delivery</option>
                    <option value="shortage">Shortage</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Driver</label>
                  <input value={form.driverName} onChange={e => set('driverName', e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Vehicle</label>
                  <input value={form.vehicle} onChange={e => set('vehicle', e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Open Reading (L)</label>
                  <input type="number" value={form.openReading} onChange={e => set('openReading', e.target.value)}
                    placeholder="—" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Close Reading (L)</label>
                  <input type="number" value={form.closeReading} onChange={e => set('closeReading', e.target.value)}
                    placeholder="—" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Litres</label>
                  <input type="number" value={form.litres} onChange={e => set('litres', e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Rate per Litre (R)</label>
                  <input type="number" step="0.01" value={form.ratePerLitre} onChange={e => set('ratePerLitre', e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Notes</label>
                <input value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="Any notes…" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form.isEstimated} onChange={e => set('isEstimated', e.target.checked)}
                  className="rounded border-gray-300" />
                Litres are estimated (no meter reading)
              </label>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Inline allocate modal ─────────────────────────────────────────────────────

type AllocBlock = { allocType: 'onsite' | 'offsite'; clientName: string; hoursWorked: string; litres: string }

function AllocateButton({ fill, onDone }: { fill: Fill; onDone: (updated: any) => void }) {
  const [open, setOpen]       = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [blocks, setBlocks]   = useState<AllocBlock[]>([
    { allocType: 'offsite', clientName: '', hoursWorked: '', litres: fill.litres },
  ])

  const totalFill   = parseFloat(fill.litres)
  const allocated   = blocks.reduce((s, b) => s + (parseFloat(b.litres) || 0), 0)
  const remaining   = totalFill - allocated
  const rate        = parseFloat(fill.ratePerLitre)

  // When hours change, redistribute litres by ratio across all blocks
  function updateBlock(i: number, key: keyof AllocBlock, val: string) {
    setBlocks(prev => {
      const next = prev.map((b, idx) => idx === i ? { ...b, [key]: val } : b)

      if (key === 'hoursWorked') {
        const totalHrs = next.reduce((s, b) => s + (parseFloat(b.hoursWorked) || 0), 0)
        if (totalHrs > 0) {
          return next.map(b => ({
            ...b,
            litres: ((parseFloat(b.hoursWorked) || 0) / totalHrs * totalFill).toFixed(2),
          }))
        }
      }
      return next
    })
  }

  function addBlock(type: 'onsite' | 'offsite') {
    setBlocks(prev => [...prev, { allocType: type, clientName: '', hoursWorked: '', litres: '0' }])
  }

  async function save() {
    if (Math.abs(remaining) > 0.5) { setError(`${remaining.toFixed(1)}L still unallocated`); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/fuel-fills/${fill.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finalise',
          allocations: blocks.map(b => ({
            allocType:   b.allocType,
            clientName:  b.clientName || null,
            hoursWorked: b.hoursWorked ? parseFloat(b.hoursWorked) : null,
            litres:      parseFloat(b.litres),
          })),
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error); return }
      const data = await res.json()
      onDone(data)
      setOpen(false)
    } finally { setSaving(false) }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
      >
        Allocate <ChevronRight size={13} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Allocate Fill</h3>
                <p className="text-xs text-gray-400">{fmtDate(fill.fillDate)} · {fill.driverName} · {fill.vehicle} · {totalFill.toFixed(0)}L total</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
            </div>

            <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {blocks.map((b, i) => (
                <div key={i} className={cn('rounded-lg border p-3 space-y-2', b.allocType === 'offsite' ? 'border-blue-200 bg-blue-50/40' : 'border-green-200 bg-green-50/40')}>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {(['offsite', 'onsite'] as const).map(t => (
                        <button key={t} onClick={() => updateBlock(i, 'allocType', t)}
                          className={cn('px-2.5 py-1 rounded-md text-xs font-medium', b.allocType === t
                            ? t === 'offsite' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'
                            : 'bg-white border border-gray-200 text-gray-500')}>
                          {t === 'offsite' ? '🔵 Off-site' : '🟢 On-site'}
                        </button>
                      ))}
                    </div>
                    {blocks.length > 1 && (
                      <button onClick={() => setBlocks(prev => prev.filter((_, idx) => idx !== i))} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {b.allocType === 'offsite' && (
                      <div className="col-span-3">
                        <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Client</label>
                        <input value={b.clientName} onChange={e => updateBlock(i, 'clientName', e.target.value)}
                          placeholder="e.g. Corrie" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Hours</label>
                      <input type="number" value={b.hoursWorked} onChange={e => updateBlock(i, 'hoursWorked', e.target.value)}
                        placeholder="0" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Litres</label>
                      <input type="number" value={b.litres} onChange={e => updateBlock(i, 'litres', e.target.value)}
                        className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Cost (R)</label>
                      <div className="mt-0.5 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-sm font-semibold text-gray-700">
                        {((parseFloat(b.litres) || 0) * rate).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button onClick={() => addBlock('offsite')} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                  <Plus size={12} /> Off-site job
                </button>
                <button onClick={() => addBlock('onsite')} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                  <Plus size={12} /> On-site block
                </button>
              </div>

              {/* Running balance */}
              <div className={cn('rounded-lg px-4 py-3 text-sm flex items-center justify-between', Math.abs(remaining) <= 0.5 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200')}>
                <span className="font-medium text-gray-700">Remaining to allocate</span>
                <span className={cn('font-bold tabular-nums', Math.abs(remaining) <= 0.5 ? 'text-green-700' : 'text-amber-700')}>
                  {remaining.toFixed(1)} L {Math.abs(remaining) <= 0.5 ? '✓' : ''}
                </span>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving || Math.abs(remaining) > 0.5}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Finalise Fill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
