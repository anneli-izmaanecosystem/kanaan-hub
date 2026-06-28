'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { cn, fmtDate } from '@/lib/utils'

type ClientBlock = { clientName: string; billingInfo: string; hoursWorked: string }

type DayClient = { id: number; clientName: string; billingInfo: string | null; hoursWorked: string }
type LinkedAlloc = { id: number; allocType: string; clientName: string | null; litres: string; cost: string }

type Day = {
  id: number
  dayDate: string
  dayType: 'onsite' | 'offsite' | 'partial'
  notes: string | null
  status: 'draft' | 'final'
  clients: DayClient[]
  linkedAllocations: LinkedAlloc[]
}

const DAY_BADGE: Record<string, string> = {
  onsite:  'bg-green-100 text-green-800',
  offsite: 'bg-blue-100 text-blue-800',
  partial: 'bg-amber-100 text-amber-800',
}

const DAY_LABEL: Record<string, string> = {
  onsite: 'On-site', offsite: 'Off-site', partial: 'Partial',
}

const TLB_RATE = 575

export default function AlpheusDaysPage() {
  const [days, setDays]         = useState<Day[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  // Form state
  const [dayDate, setDayDate]   = useState(() => new Date().toISOString().split('T')[0])
  const [dayType, setDayType]   = useState<'onsite' | 'offsite' | 'partial'>('offsite')
  const [notes, setNotes]       = useState('')
  const [clients, setClients]   = useState<ClientBlock[]>([{ clientName: '', billingInfo: '', hoursWorked: '' }])

  useEffect(() => {
    fetch('/api/alpheus-days').then(r => r.json()).then(d => {
      setDays(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function updateClient(i: number, key: keyof ClientBlock, val: string) {
    setClients(prev => prev.map((c, idx) => idx === i ? { ...c, [key]: val } : c))
  }

  function addClient() {
    setClients(prev => [...prev, { clientName: '', billingInfo: '', hoursWorked: '' }])
  }

  function removeClient(i: number) {
    setClients(prev => prev.filter((_, idx) => idx !== i))
  }

  const showClients = dayType === 'offsite' || dayType === 'partial'
  const totalHours  = clients.reduce((s, c) => s + (parseFloat(c.hoursWorked) || 0), 0)
  const labourExcl  = totalHours * TLB_RATE

  async function save() {
    if (!dayDate) { setError('Date is required'); return }
    if (showClients && clients.some(c => !c.clientName || !c.hoursWorked)) {
      setError('Client name and hours required for each client block'); return
    }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/alpheus-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayDate,
          dayType,
          notes: notes || null,
          clients: showClients ? clients.map(c => ({
            clientName:  c.clientName,
            billingInfo: c.billingInfo || null,
            hoursWorked: parseFloat(c.hoursWorked),
          })) : [],
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error); return }
      const data = await res.json()
      setDays(prev => [{ ...data.day, clients: data.clients, linkedAllocations: [] }, ...prev])
      // reset
      setDayDate(new Date().toISOString().split('T')[0])
      setDayType('offsite')
      setNotes('')
      setClients([{ clientName: '', billingInfo: '', hoursWorked: '' }])
    } finally { setSaving(false) }
  }

  const totalOffsite = days.filter(d => d.dayType !== 'onsite').length
  const totalOnsite  = days.filter(d => d.dayType === 'onsite').length
  const totalHrsAll  = days.reduce((s, d) => s + d.clients.reduce((cs, c) => cs + parseFloat(c.hoursWorked), 0), 0)

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard/fuel" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
          <ChevronLeft size={15} /> Fuel Log
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold text-gray-900">Alpheus — Days Worked</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Off-site Days', value: totalOffsite, color: 'text-blue-700' },
          { label: 'On-site Days', value: totalOnsite, color: 'text-green-700' },
          { label: 'Total Hours Logged', value: totalHrsAll.toFixed(1), color: 'text-gray-900' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[360px_1fr] gap-6">

        {/* Form */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Log a Day</h2>
            <p className="text-xs text-gray-400 mt-0.5">Captured by manager</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Date</label>
              <input type="date" value={dayDate} onChange={e => setDayDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Type of Day</label>
              <div className="mt-1 flex rounded-lg border border-gray-200 overflow-hidden">
                {(['onsite', 'offsite', 'partial'] as const).map(t => (
                  <button key={t} onClick={() => setDayType(t)}
                    className={cn(
                      'flex-1 py-2 text-xs font-medium transition-colors',
                      dayType === t
                        ? t === 'onsite' ? 'bg-green-600 text-white' : t === 'offsite' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    )}>
                    {DAY_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Client blocks (offsite / partial) */}
            {showClients && (
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Client{clients.length > 1 ? 's' : ''}</label>
                {clients.map((c, i) => (
                  <div key={i} className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-700">Client {clients.length > 1 ? i + 1 : ''}</span>
                      {clients.length > 1 && (
                        <button onClick={() => removeClient(i)} className="text-red-400 hover:text-red-600">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <input value={c.clientName} onChange={e => updateClient(i, 'clientName', e.target.value)}
                      placeholder="Client name (e.g. Corrie)" className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    <input value={c.billingInfo} onChange={e => updateClient(i, 'billingInfo', e.target.value)}
                      placeholder="Billing info (optional)" className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Hours worked</label>
                        <input type="number" value={c.hoursWorked} onChange={e => updateClient(i, 'hoursWorked', e.target.value)}
                          placeholder="e.g. 8" className="mt-0.5 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Labour excl VAT</label>
                        <div className="mt-0.5 rounded-md border border-gray-100 bg-white px-2.5 py-1.5 text-sm font-semibold text-green-700">
                          R {((parseFloat(c.hoursWorked) || 0) * TLB_RATE).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {dayType === 'partial' && (
                  <button onClick={addClient} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                    <Plus size={13} /> Add another client
                  </button>
                )}

                {totalHours > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 flex justify-between text-xs">
                    <span className="text-gray-500">Total — {totalHours.toFixed(1)} hrs @ R{TLB_RATE}/hr</span>
                    <span className="font-bold text-gray-900">R {labourExcl.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Any notes…" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button onClick={save} disabled={saving}
              className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Day'}
            </button>
          </div>
        </div>

        {/* Days table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">All Days</h2>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-gray-400">Loading…</p>
          ) : days.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-gray-400">No days logged yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Client(s)</th>
                  <th className="px-4 py-3 text-right font-medium">Hours</th>
                  <th className="px-4 py-3 text-right font-medium">Labour excl VAT</th>
                  <th className="px-4 py-3 text-right font-medium">Diesel (L)</th>
                  <th className="px-4 py-3 text-center font-medium">Matched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {days.map(d => {
                  const hrs     = d.clients.reduce((s, c) => s + parseFloat(c.hoursWorked), 0)
                  const labour  = hrs * TLB_RATE
                  const diesel  = d.linkedAllocations.reduce((s, a) => s + parseFloat(a.litres), 0)
                  const matched = d.linkedAllocations.length > 0

                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fmtDate(d.dayDate)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', DAY_BADGE[d.dayType])}>
                          {DAY_LABEL[d.dayType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {d.clients.length === 0 ? (
                          <span className="text-gray-400">Kanaan</span>
                        ) : (
                          d.clients.map((c, i) => (
                            <span key={c.id} className="block text-xs">
                              {c.clientName}{i < d.clients.length - 1 ? ',' : ''}
                            </span>
                          ))
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{hrs > 0 ? hrs.toFixed(1) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{labour > 0 ? `R ${labour.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {diesel > 0 ? <span className="text-blue-700 font-medium">{diesel.toFixed(0)} L</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {matched
                          ? <span className="text-green-500 text-sm">✓</span>
                          : <span className="text-amber-400 text-xs">⚠ No fill</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
