'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Plus, Trash2, Pencil, X, Check, AlertCircle } from 'lucide-react'
import { cn, fmtDate } from '@/lib/utils'
import { calculateAlpheusSalary, ALPHEUS_ONSITE_RATE, ALPHEUS_OFFSITE_RATE, ALPHEUS_MIN_MONTHLY, ALPHEUS_FLOOR_MIN_DAYS } from '@/lib/payroll'

type ClientBlock = { clientName: string; billingInfo: string; hoursWorked: string }

type DayClient = { id: number; clientName: string; billingInfo: string | null; hoursWorked: string }
type LinkedAlloc = { id: number; allocType: string; clientName: string | null; litres: string; cost: string }

type Day = {
  id: number
  dayDate: string
  dayType: 'onsite' | 'offsite' | 'partial'
  onsiteHours: string | null
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

const tlbRateNum_DEFAULT = 4500 / 8  // R562.50/hr (R4500/day ÷ 8hrs)

function emptyClient(): ClientBlock {
  return { clientName: '', billingInfo: '', hoursWorked: '' }
}

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function AlpheusDaysPage() {
  const [days, setDays]       = useState<Day[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Form state (new log)
  const [dayDate, setDayDate]       = useState(() => new Date().toISOString().split('T')[0])
  const [dayType, setDayType]       = useState<'onsite' | 'offsite' | 'partial'>('offsite')
  const [onsiteHours, setOnsiteHours] = useState('')
  const [notes, setNotes]           = useState('')
  const [clients, setClients]       = useState<ClientBlock[]>([emptyClient()])

  // TLB billing rate — editable, defaults to R4500/day ÷ 8hrs
  const [tlbRate, setTlbRate] = useState(String(tlbRateNum_DEFAULT))
  const tlbRateNum = parseFloat(tlbRate) || tlbRateNum_DEFAULT

  // Salary month filter
  const [salaryMonth, setSalaryMonth]   = useState(currentYearMonth())

  // Delete state
  const [deletingId, setDeletingId]     = useState<number | null>(null)
  const [deleteError, setDeleteError]   = useState('')

  // Edit state
  const [editId, setEditId]               = useState<number | null>(null)
  const [editDate, setEditDate]           = useState('')
  const [editType, setEditType]           = useState<'onsite' | 'offsite' | 'partial'>('offsite')
  const [editOnsiteHours, setEditOnsiteHours] = useState('')
  const [editNotes, setEditNotes]         = useState('')
  const [editClients, setEditClients]     = useState<ClientBlock[]>([emptyClient()])
  const [editSaving, setEditSaving]       = useState(false)
  const [editError, setEditError]         = useState('')

  const [refreshing, setRefreshing] = useState(false)

  function loadDays() {
    return fetch('/api/alpheus-days').then(r => r.json()).then(d => {
      setDays(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => { loadDays() }, [])

  async function handleRefresh() {
    setRefreshing(true)
    await loadDays()
    setRefreshing(false)
  }

  // ── New log helpers ──────────────────────────────────────────────────────────
  function updateClient(i: number, key: keyof ClientBlock, val: string) {
    setClients(prev => prev.map((c, idx) => idx === i ? { ...c, [key]: val } : c))
  }
  function addClient() { setClients(prev => [...prev, emptyClient()]) }
  function removeClient(i: number) { setClients(prev => prev.filter((_, idx) => idx !== i)) }

  const showClients = dayType === 'offsite' || dayType === 'partial'
  const totalHours  = clients.reduce((s, c) => s + (parseFloat(c.hoursWorked) || 0), 0)
  const labourExcl  = totalHours * tlbRateNum

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
          onsiteHours: dayType === 'partial' && onsiteHours ? parseFloat(onsiteHours) : null,
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
      setDayDate(new Date().toISOString().split('T')[0])
      setDayType('offsite')
      setOnsiteHours('')
      setNotes('')
      setClients([emptyClient()])
    } finally { setSaving(false) }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function confirmDelete(id: number) {
    setDeleteError('')
    try {
      const res = await fetch(`/api/alpheus-days/${id}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json(); setDeleteError(e.error); return }
      setDays(prev => prev.filter(d => d.id !== id))
    } catch { setDeleteError('Failed to delete') }
    setDeletingId(null)
  }

  // ── Edit helpers ─────────────────────────────────────────────────────────────
  function startEdit(d: Day) {
    setEditId(d.id)
    setEditDate(d.dayDate)
    setEditType(d.dayType)
    setEditOnsiteHours(d.onsiteHours ?? '')
    setEditNotes(d.notes ?? '')
    setEditClients(d.clients.length ? d.clients.map(c => ({
      clientName: c.clientName, billingInfo: c.billingInfo ?? '', hoursWorked: c.hoursWorked,
    })) : [emptyClient()])
    setEditError('')
  }

  function cancelEdit() { setEditId(null); setEditError('') }

  function updateEditClient(i: number, key: keyof ClientBlock, val: string) {
    setEditClients(prev => prev.map((c, idx) => idx === i ? { ...c, [key]: val } : c))
  }

  const editShowClients = editType === 'offsite' || editType === 'partial'

  async function saveEdit() {
    if (!editDate) { setEditError('Date is required'); return }
    if (editShowClients && editClients.some(c => !c.clientName || !c.hoursWorked)) {
      setEditError('Client name and hours required for each client block'); return
    }
    setEditSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/alpheus-days/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayDate:     editDate,
          dayType:     editType,
          onsiteHours: editType === 'partial' && editOnsiteHours ? parseFloat(editOnsiteHours) : null,
          notes:       editNotes || null,
          clients: editShowClients ? editClients.map(c => ({
            clientName:  c.clientName,
            billingInfo: c.billingInfo || null,
            hoursWorked: parseFloat(c.hoursWorked),
          })) : [],
        }),
      })
      if (!res.ok) { const e = await res.json(); setEditError(e.error); return }
      const data = await res.json()
      setDays(prev => prev.map(d => d.id === editId
        ? { ...d, ...data.day, clients: data.clients }
        : d
      ))
      setEditId(null)
    } finally { setEditSaving(false) }
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalOffsite = days.filter(d => d.dayType !== 'onsite').length
  const totalOnsite  = days.filter(d => d.dayType === 'onsite').length
  const totalHrsAll  = days.reduce((s, d) => s + d.clients.reduce((cs, c) => cs + parseFloat(c.hoursWorked), 0), 0)

  // ── Salary calc for selected month ───────────────────────────────────────────
  const monthDays = days.filter(d => d.dayDate.startsWith(salaryMonth))
  const salary    = calculateAlpheusSalary(monthDays.map(d => ({
    dayType:      d.dayType,
    onsiteHours:  d.onsiteHours,
    offsiteHours: d.clients.reduce((s, c) => s + parseFloat(c.hoursWorked), 0),
    isSaturday:   new Date(d.dayDate + 'T12:00:00Z').getUTCDay() === 6,
  })))

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
      <div className="grid grid-cols-3 gap-4 mb-4">
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

      {/* ── Monthly salary summary ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Monthly Salary — Alpheus</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              On-site R{ALPHEUS_ONSITE_RATE}/day · Off-site R{ALPHEUS_OFFSITE_RATE}/day · Partial apportioned · Min R{ALPHEUS_MIN_MONTHLY.toLocaleString('en-ZA')}/month
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh amounts"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
            <input
              type="month"
              value={salaryMonth}
              onChange={e => setSalaryMonth(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>
        </div>

        {monthDays.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-400">No days logged for this month.</p>
        ) : (
          <div className="px-5 py-4">
            {/* Type breakdown — all days including Saturday */}
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[
                { label: `On-site (${salary.onsiteDays}d × R${ALPHEUS_ONSITE_RATE})`,    value: salary.onsitePay,  color: 'text-green-700', show: salary.onsiteDays  > 0 },
                { label: `Off-site (${salary.offsiteDays}d × R${ALPHEUS_OFFSITE_RATE})`, value: salary.offsitePay, color: 'text-blue-700',  show: salary.offsiteDays > 0 },
                { label: `Partial (${salary.partialDays}d apportioned)`,                  value: salary.partialPay, color: 'text-amber-700', show: salary.partialDays > 0 },
              ].filter(s => s.show).map(s => (
                <div key={s.label} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-[11px] text-gray-500 mb-1">{s.label}</p>
                  <p className={cn('text-lg font-bold tabular-nums', s.color)}>R {s.value.toFixed(2)}</p>
                </div>
              ))}
            </div>

            {/* Weekday / Saturday split */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[11px] text-gray-500 mb-1">Weekday portion ({salary.weekdayDaysWorked}d)</p>
                <p className="text-lg font-bold tabular-nums text-gray-900">R {salary.weekdayEarned.toFixed(2)}</p>
              </div>
              {salary.saturdayDays > 0 && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-[11px] text-blue-600 mb-1">Saturday ({salary.saturdayDays}d — on top of floor)</p>
                  <p className="text-lg font-bold tabular-nums text-blue-700">+ R {salary.saturdayEarned.toFixed(2)}</p>
                </div>
              )}
            </div>

            <div className={cn(
              'flex items-center justify-between rounded-xl px-5 py-4',
              salary.floorApplied ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'
            )}>
              <div>
                <p className={cn('text-xs font-semibold uppercase tracking-wide', salary.floorApplied ? 'text-amber-700' : 'text-green-700')}>
                  {salary.floorApplied
                    ? `Floor applied — weekdays R${salary.weekdayEarned.toFixed(2)} < R${ALPHEUS_MIN_MONTHLY.toLocaleString()}`
                    : (salary.weekdayDaysWorked + salary.saturdayDays) < ALPHEUS_FLOOR_MIN_DAYS
                      ? `Below ${ALPHEUS_FLOOR_MIN_DAYS}-day threshold — no floor`
                      : 'Above minimum — no floor needed'}
                </p>
                <p className="text-sm text-gray-600 mt-0.5">{monthDays.length} day{monthDays.length !== 1 ? 's' : ''} logged</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 mb-0.5">Pay this month</p>
                <p className={cn('text-3xl font-bold tabular-nums', salary.floorApplied ? 'text-amber-700' : 'text-green-700')}>
                  R {salary.finalPay.toFixed(2)}
                </p>
              </div>
            </div>

            {deleteError && <p className="mt-2 text-xs text-red-600">{deleteError}</p>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[360px_1fr] gap-6">

        {/* ── Log form ── */}
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

            {/* Partial: on-site hours at Kanaan */}
            {dayType === 'partial' && (
              <div className="rounded-lg border border-green-100 bg-green-50/40 p-3 space-y-1">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-green-700">On-site hours (Kanaan)</label>
                <input type="number" value={onsiteHours} onChange={e => setOnsiteHours(e.target.value)}
                  placeholder="e.g. 4"
                  className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" />
              </div>
            )}

            {/* Client blocks (offsite / partial) */}
            {showClients && (
              <div className="space-y-3">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">
                  {dayType === 'partial' ? 'Off-site client(s)' : `Client${clients.length > 1 ? 's' : ''}`}
                </label>
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
                          R {((parseFloat(c.hoursWorked) || 0) * tlbRateNum).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                <button onClick={addClient} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  <Plus size={13} /> Add another client
                </button>

                {totalHours > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 flex justify-between text-xs">
                    <span className="text-gray-500">Total — {totalHours.toFixed(1)} hrs @ R{tlbRateNum}/hr</span>
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

            {/* TLB billing rate */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">TLB Billing Rate</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">R/hr charged to clients · daily = R{(tlbRateNum * 8).toFixed(0)}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">R</span>
                  <input
                    type="number"
                    step="0.01"
                    value={tlbRate}
                    onChange={e => setTlbRate(e.target.value)}
                    className="w-24 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-xs text-gray-500">/hr</span>
                </div>
              </div>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button onClick={save} disabled={saving}
              className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Day'}
            </button>
          </div>
        </div>

        {/* ── Days table ── */}
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
                  <th className="px-4 py-3 text-right font-medium">On-site h</th>
                  <th className="px-4 py-3 text-right font-medium">Off-site h</th>
                  <th className="px-4 py-3 text-right font-medium">Labour excl VAT</th>
                  <th className="px-4 py-3 text-right font-medium">Diesel (L)</th>
                  <th className="px-4 py-3 text-center font-medium">Matched</th>
                  <th className="px-4 py-3 text-center font-medium w-10"></th>
                  <th className="px-4 py-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {days.map(d => {
                  const offHrs  = d.clients.reduce((s, c) => s + parseFloat(c.hoursWorked), 0)
                  const onHrs   = parseFloat(d.onsiteHours ?? '0')
                  const labour  = offHrs * tlbRateNum
                  const diesel  = d.linkedAllocations.reduce((s, a) => s + parseFloat(a.litres), 0)
                  const matched = d.linkedAllocations.length > 0

                  if (editId === d.id) {
                    // ── Inline edit row ──────────────────────────────────────
                    return (
                      <tr key={d.id} className="bg-amber-50">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="space-y-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                                className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
                              <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
                                {(['onsite', 'offsite', 'partial'] as const).map(t => (
                                  <button key={t} onClick={() => setEditType(t)}
                                    className={cn(
                                      'px-3 py-1.5 font-medium transition-colors',
                                      editType === t
                                        ? t === 'onsite' ? 'bg-green-600 text-white' : t === 'offsite' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'
                                        : 'text-gray-500 hover:bg-gray-50'
                                    )}>
                                    {DAY_LABEL[t]}
                                  </button>
                                ))}
                              </div>
                              {editType === 'partial' && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-green-700 font-medium">On-site h:</span>
                                  <input type="number" value={editOnsiteHours} onChange={e => setEditOnsiteHours(e.target.value)}
                                    placeholder="e.g. 4" className="w-20 rounded-md border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-200" />
                                </div>
                              )}
                              <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                                placeholder="Notes…" className="flex-1 min-w-[140px] rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
                            </div>

                            {editShowClients && (
                              <div className="space-y-2">
                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                                  {editType === 'partial' ? 'Off-site client(s)' : 'Client(s)'}
                                </p>
                                {editClients.map((c, i) => (
                                  <div key={i} className="flex items-center gap-2 flex-wrap">
                                    <input value={c.clientName} onChange={e => updateEditClient(i, 'clientName', e.target.value)}
                                      placeholder="Client" className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                    <input value={c.billingInfo} onChange={e => updateEditClient(i, 'billingInfo', e.target.value)}
                                      placeholder="Billing (opt)" className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                    <input type="number" value={c.hoursWorked} onChange={e => updateEditClient(i, 'hoursWorked', e.target.value)}
                                      placeholder="Hrs" className="rounded-md border border-gray-200 px-2.5 py-1.5 text-sm w-16 focus:outline-none focus:ring-2 focus:ring-blue-200" />
                                    {editClients.length > 1 && (
                                      <button onClick={() => setEditClients(prev => prev.filter((_, idx) => idx !== i))}
                                        className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                                    )}
                                  </div>
                                ))}
                                <button onClick={() => setEditClients(prev => [...prev, emptyClient()])}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                                  <Plus size={12} /> Add client
                                </button>
                              </div>
                            )}

                            {editError && <p className="text-xs text-red-600">{editError}</p>}

                            <div className="flex items-center gap-2">
                              <button onClick={saveEdit} disabled={editSaving}
                                className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white font-medium hover:bg-gray-700 disabled:opacity-40">
                                <Check size={13} /> {editSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={cancelEdit}
                                className="flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                                <X size={13} /> Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  }

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
                      <td className="px-4 py-3 text-right tabular-nums text-green-700">
                        {onHrs > 0 ? onHrs.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {offHrs > 0 ? offHrs.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{labour > 0 ? `R ${labour.toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {diesel > 0 ? <span className="text-blue-700 font-medium">{diesel.toFixed(0)} L</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {matched
                          ? <span className="text-green-500 text-sm">✓</span>
                          : <span className="text-amber-400 text-xs">⚠ No fill</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => startEdit(d)} className="text-gray-400 hover:text-gray-700">
                          <Pencil size={14} />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {deletingId === d.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button onClick={() => confirmDelete(d.id)}
                              className="rounded bg-red-600 px-2 py-0.5 text-[11px] text-white font-medium hover:bg-red-700">
                              Confirm
                            </button>
                            <button onClick={() => setDeletingId(null)}
                              className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-500 hover:bg-gray-50">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setDeletingId(d.id)} className="text-gray-300 hover:text-red-500">
                            <Trash2 size={13} />
                          </button>
                        )}
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
