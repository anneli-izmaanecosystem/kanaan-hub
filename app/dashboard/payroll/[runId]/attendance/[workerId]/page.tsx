'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmt, fmtDate } from '@/lib/utils'
import { Plus, Trash2, AlertTriangle, Sun, Star, Upload, Check, X, ChevronLeft, ChevronRight, Camera } from 'lucide-react'
import { round2 } from '@/lib/payroll'

// ── Types ──────────────────────────────────────────────────────────────────────
type Worker = {
  id: number; name: string; workerType: string; payStructure: string
  hourlyRate: string | null; stdHoursPerDay: string | null
  dailyRate: string | null; floorSalary: string | null; saturdayRate: string | null
  department: string | null; position: string | null
}
type Run = { id: number; periodStart: string; periodEnd: string; status: string }
type RunWorker = { id: number; name: string }
type Entry = { markedReady: boolean; markedReadyAt: string | null }
type Day = {
  date: string; dayType: string; holidayName: string | null
  id: number | null; hoursWorked: string | null; absent: boolean
  absenceReason: string | null; calculatedAmount: string | null
  phDoubleConfirmed: boolean | null; source: string; note: string | null
}
type Advance = {
  id: number; date: string; amount: string
  advanceType: string; note: string | null
}

const DAY_LABELS: Record<string, string> = {
  weekday: '', saturday: 'Sat', sunday: 'Sun', public_holiday: 'PH',
}
const ABSENCE_OPTS = [
  { value: 'sick',         label: 'Sick leave' },
  { value: 'annual_leave', label: 'Annual leave' },
  { value: 'unpaid',       label: 'Unpaid leave' },
  { value: 'other',        label: 'Other' },
]

// ── Amount calculator (mirrors payroll engine) ─────────────────────────────────
function calcAmount(worker: Worker, day: Day, phDouble: boolean): number {
  if (day.absent) return 0

  if (worker.payStructure === 'hourly') {
    const rate  = parseFloat(worker.hourlyRate ?? '0')
    const hours = parseFloat(day.hoursWorked ?? worker.stdHoursPerDay ?? '0')
    if (day.dayType === 'saturday')       return round2(hours * rate)  // normal rate within 45h average
    if (day.dayType === 'public_holiday') return worker.workerType === 'employee' && phDouble ? round2(hours * rate * 2) : round2(hours * rate)
    if (day.dayType === 'sunday')         return worker.workerType === 'employee' ? round2(hours * rate * 2) : 0
    return round2(hours * rate)
  }

  if (worker.payStructure === 'daily') {
    const rate = parseFloat(worker.dailyRate ?? '0')
    if (day.dayType === 'public_holiday') return worker.workerType === 'employee' && phDouble ? round2(rate * 2) : (worker.workerType === 'contractor' ? 0 : rate)
    if (day.dayType === 'sunday')         return worker.workerType === 'employee' ? round2(rate * 2) : 0
    return rate
  }

  if (worker.payStructure === 'floor') {
    // Floor days: return the saturday top-up; floor itself is a monthly total
    if (day.dayType === 'saturday') return parseFloat(worker.saturdayRate ?? '0')
    return 0 // weekdays absorbed in floor
  }

  return 0
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AttendancePage() {
  const { runId, workerId } = useParams<{ runId: string; workerId: string }>()

  const [run,        setRun]        = useState<Run | null>(null)
  const [worker,     setWorker]     = useState<Worker | null>(null)
  const [days,       setDays]       = useState<Day[]>([])
  const [advances,   setAdvances]   = useState<Advance[]>([])
  const [loading,    setLoading]    = useState(true)
  const [runWorkers, setRunWorkers] = useState<RunWorker[]>([])

  const [entry, setEntry] = useState<Entry | null>(null)
  const [markingSaved, setMarkingSaved] = useState(false)

  // Timesheet upload
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading,      setUploading]      = useState(false)
  const [uploadPreview,  setUploadPreview]  = useState<{ date: string; present: boolean; hours: number | null; absent_reason: string | null; note: string | null }[] | null>(null)
  const [uploadShopDeds, setUploadShopDeds] = useState<{ date: string; amount: number; note: string | null }[]>([])
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([])
  const [uploadError,    setUploadError]    = useState('')
  const [importingSel,   setImportingSel]   = useState<Set<number>>(new Set())

  // Import from Fuel Log (Alpheus / floor workers)
  const [importingFuel, setImportingFuel] = useState(false)
  const [importFuelMsg, setImportFuelMsg] = useState('')

  // Advance form
  const [showAdvForm, setShowAdvForm] = useState(false)
  const [advForm, setAdvForm] = useState({ date: '', amount: '', advanceType: 'cash_advance', note: '' })
  const [advSaving, setAdvSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/payroll/${runId}/attendance/${workerId}`).then(r => r.json()),
      fetch(`/api/payroll/${runId}/advances/${workerId}`).then(r => r.json()),
      fetch(`/api/payroll/${runId}`).then(r => r.json()),
      // entries-by-worker is non-critical — fall back to null on any failure
      fetch(`/api/payroll/${runId}/entries-by-worker/${workerId}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
    ]).then(([att, adv, run, ent]) => {
      setRun(att.run)
      setWorker(att.worker)
      setDays(att.days ?? [])
      setAdvances(Array.isArray(adv) ? adv : [])
      setRunWorkers(
        (run.entries ?? [])
          .map((e: any) => ({ id: e.worker.id, name: e.worker.name }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name))
      )
      setEntry(ent && ent.markedReady !== undefined ? ent : null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [runId, workerId])

  useEffect(() => { load() }, [load])

  // Recalculate amounts for days imported via bulk upload (calculatedAmount is null)
  useEffect(() => {
    if (!worker || days.length === 0) return
    const nullDays = days.filter(d => !d.absent && d.calculatedAmount === null && d.id !== null)
    if (nullDays.length === 0) return
    nullDays.forEach(day => {
      const amount = calcAmount(worker, day, day.phDoubleConfirmed === true)
      if (amount > 0) saveDay(day, {})  // re-save to trigger amount calculation
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker, days.length])

  const isLocked = run?.status === 'finalised'

  // ── Attendance save ──────────────────────────────────────────────────────────
  async function saveDay(day: Day, patch: Partial<Day>) {
    const merged = { ...day, ...patch }
    const phDouble = merged.phDoubleConfirmed === true
    const amount = calcAmount(worker!, merged, phDouble)

    const res = await fetch(`/api/payroll/${runId}/attendance/${workerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...merged, calculatedAmount: String(amount) }),
    })
    if (res.ok) {
      const saved = await res.json()
      setDays(prev => {
        const next = prev.map(d => d.date === day.date ? { ...d, ...merged, id: saved.id, calculatedAmount: String(amount) } : d)
        syncEntry(next)
        return next
      })
    }
  }

  // ── Sync payroll entry — calls server-side recalculation from saved DB data ──
  function syncEntry(_currentDays?: Day[], _currentAdvances?: Advance[]) {
    // The /sync route reads attendance + advances from DB and recalculates.
    // This avoids the stale entryId bug (entries route uses entryId, not workerId).
    fetch(`/api/payroll/${runId}/attendance/${workerId}/sync`, {
      method: 'POST',
    }).catch(() => {/* fire and forget */})
  }


  async function savePayroll() {
    setMarkingSaved(true)
    // First sync attendance
    await fetch(`/api/payroll/${runId}/attendance/${workerId}/sync`, { method: 'POST' })
    // Then mark as ready
    await fetch(`/api/payroll/${runId}/entries-by-worker/${workerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markedReady: true }),
    })
    setEntry(prev => prev ? { ...prev, markedReady: true, markedReadyAt: new Date().toISOString() } : prev)
    setMarkingSaved(false)
  }

  // ── Advance add ──────────────────────────────────────────────────────────────
  async function addAdvance(e: React.FormEvent) {
    e.preventDefault(); setAdvSaving(true)
    const res = await fetch(`/api/payroll/${runId}/advances/${workerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(advForm),
    })
    if (res.ok) {
      const adv = await res.json()
      setAdvances(prev => {
        const next = [...prev, adv]
        syncEntry(days, next)
        return next
      })
      setAdvForm({ date: '', amount: '', advanceType: 'cash_advance', note: '' })
      setShowAdvForm(false)
    }
    setAdvSaving(false)
  }

  async function deleteAdvance(id: number) {
    const res = await fetch(`/api/payroll/${runId}/advances/${workerId}?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      setAdvances(prev => {
        const next = prev.filter(a => a.id !== id)
        syncEntry(days, next)
        return next
      })
    }
  }

  async function importFromFuelLog() {
    setImportingFuel(true); setImportFuelMsg('')
    const res = await fetch(`/api/payroll/${runId}/attendance/${workerId}/import-alpheus`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setImportFuelMsg(`Imported ${data.imported} day${data.imported !== 1 ? 's' : ''} from Fuel Log`)
      load()
    } else {
      setImportFuelMsg(data.error ?? 'Import failed')
    }
    setImportingFuel(false)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !run || !worker) return
    setUploading(true); setUploadError(''); setUploadPreview(null); setUploadWarnings([])
    const fd = new FormData()
    fd.append('file', file)
    fd.append('periodStart', run.periodStart)
    fd.append('periodEnd',   run.periodEnd)
    fd.append('workerName',  worker.name)
    const res = await fetch(`/api/payroll/${runId}/attendance/${workerId}/upload`, { method: 'POST', body: fd })
    const data = await res.json()
    if (!res.ok) { setUploadError(data.error ?? 'Upload failed'); setUploading(false); return }
    setUploadPreview(data.days ?? [])
    setUploadShopDeds(data.shop_deductions ?? [])
    setUploadWarnings(data.warnings ?? [])
    setImportingSel(new Set((data.days ?? []).map((_: any, i: number) => i)))
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function confirmImport() {
    if (!uploadPreview) return
    // Fix 1 + Fix 13: parallelise saveDay calls
    await Promise.all(
      uploadPreview
        .filter((_, i) => importingSel.has(i))
        .map(parsed => {
          const existing = days.find(d => d.date === parsed.date)
          if (!existing) return Promise.resolve()
          return saveDay(existing, {
            absent:        !parsed.present,
            absenceReason: parsed.absent_reason ?? null,
            hoursWorked:   parsed.hours != null ? String(parsed.hours) : (parsed.present ? '0' : null),
            note:          parsed.note ?? null,
          })
        })
    )
    // Import any shop deductions found on the timesheet
    await Promise.all(
      uploadShopDeds.map(ded =>
        fetch(`/api/payroll/${runId}/advances/${workerId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: ded.date,
            amount: String(ded.amount),
            advanceType: 'shop_deduction',
            note: ded.note ?? 'from timesheet',
          }),
        })
      )
    )
    // Re-sync after shop deductions so grossPay/netPay includes them
    if (uploadShopDeds.length > 0) {
      await fetch(`/api/payroll/${runId}/attendance/${workerId}/sync`, { method: 'POST' }).catch(() => {})
    }
    setUploadPreview(null)
    setUploadShopDeds([])
    setUploadWarnings([])
    load()
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!worker || !run) return <div className="p-8 text-sm text-red-500">Not found.</div>

  const totalAdvances   = advances.filter(a => a.advanceType === 'cash_advance').reduce((s, a) => s + parseFloat(a.amount), 0)
  const totalShop       = advances.filter(a => a.advanceType === 'shop_deduction').reduce((s, a) => s + parseFloat(a.amount), 0)

  // Calculate gross from attendance days
  const attendanceGross = worker.payStructure === 'floor'
    ? parseFloat(worker.floorSalary ?? '0') // floor handled separately
    : days.reduce((s, d) => {
        if (d.absent) return s
        const amt = d.calculatedAmount !== null
          ? parseFloat(d.calculatedAmount)
          : calcAmount(worker, d, d.phDoubleConfirmed === true)
        return s + amt
      }, 0)
  const saturdayExtra = worker.payStructure === 'floor'
    ? days.filter(d => d.dayType === 'saturday' && !d.absent).reduce((s, d) => s + parseFloat(d.calculatedAmount ?? '0'), 0)
    : 0
  const grossPay  = round2(attendanceGross + saturdayExtra)
  const totalDeds = round2(totalAdvances + totalShop)

  const pendingPH = days.filter(d => d.dayType === 'public_holiday' && !d.absent && d.phDoubleConfirmed === null && worker.workerType === 'employee')

  const inp = 'rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-300'

  const wid = parseInt(workerId)
  const workerIdx  = runWorkers.findIndex(w => w.id === wid)
  const prevWorker = workerIdx > 0 ? runWorkers[workerIdx - 1] : null
  const nextWorker = workerIdx >= 0 && workerIdx < runWorkers.length - 1 ? runWorkers[workerIdx + 1] : null

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb + prev/next */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/dashboard/payroll" className="hover:text-gray-600">Payroll</Link>
          <span>/</span>
          <Link href={`/dashboard/payroll/${runId}`} className="hover:text-gray-600">Run #{runId}</Link>
          <span>/</span>
          <span className="text-gray-700">{worker.name}</span>
        </div>
        {runWorkers.length > 1 && (
          <div className="flex items-center gap-1">
            <Link
              href={prevWorker ? `/dashboard/payroll/${runId}/attendance/${prevWorker.id}` : '#'}
              aria-disabled={!prevWorker}
              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                prevWorker ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-gray-100 text-gray-300 pointer-events-none'
              }`}>
              <ChevronLeft size={13} />
              {prevWorker?.name ?? 'Prev'}
            </Link>
            <span className="text-xs text-gray-400 px-1">{workerIdx + 1} / {runWorkers.length}</span>
            <Link
              href={nextWorker ? `/dashboard/payroll/${runId}/attendance/${nextWorker.id}` : '#'}
              aria-disabled={!nextWorker}
              className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                nextWorker ? 'border-gray-200 text-gray-600 hover:bg-gray-50' : 'border-gray-100 text-gray-300 pointer-events-none'
              }`}>
              {nextWorker?.name ?? 'Next'}
              <ChevronRight size={13} />
            </Link>
          </div>
        )}
      </div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">{worker.name}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)} ·{' '}
        {worker.payStructure === 'hourly' ? `R${worker.hourlyRate}/hr · ${worker.stdHoursPerDay}h/day`
          : worker.payStructure === 'daily' ? `R${worker.dailyRate}/day`
          : `R${worker.floorSalary} floor + R${worker.saturdayRate}/on-site Sat`}
      </p>

      {/* Import from Fuel Log — floor workers only */}
      {!isLocked && worker.payStructure === 'floor' && (
        <div className="mb-4 flex items-center gap-3">
          <button onClick={importFromFuelLog} disabled={importingFuel}
            className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800 font-medium hover:bg-green-100 disabled:opacity-50 transition-colors">
            {importingFuel ? 'Importing…' : '↓ Import from Fuel Log'}
          </button>
          {importFuelMsg && <p className="text-sm text-gray-500">{importFuelMsg}</p>}
        </div>
      )}

      {/* Timesheet upload */}
      {!isLocked && (
        <div className="mb-6">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          {!uploadPreview && (
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-sm text-gray-500 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              <Upload size={15} />
              {uploading ? 'Reading timesheet…' : 'Upload timesheet photo (OCR)'}
            </button>
          )}
          {uploadError && <p className="mt-2 text-sm text-red-600">{uploadError}</p>}

          {/* OCR preview */}
          {uploadPreview && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-blue-900">Timesheet parsed — {uploadPreview.length} days found</p>
                <button onClick={() => { setUploadPreview(null); setUploadShopDeds([]) }} className="text-blue-400 hover:text-blue-700"><X size={16} /></button>
              </div>

              {uploadWarnings.length > 0 && (
                <div className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800">
                  {uploadWarnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}

              <div className="space-y-1 mb-4 max-h-72 overflow-y-auto">
                {uploadPreview.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                    <input type="checkbox" checked={importingSel.has(i)}
                      onChange={e => setImportingSel(prev => {
                        const n = new Set(prev)
                        e.target.checked ? n.add(i) : n.delete(i)
                        return n
                      })} />
                    <span className="font-medium text-gray-700 w-24 flex-shrink-0">{fmtDate(p.date)}</span>
                    {/* Present toggle */}
                    <button
                      type="button"
                      onClick={() => setUploadPreview(prev => prev ? prev.map((x, j) => j === i ? { ...x, present: !x.present } : x) : prev)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${p.present ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {p.present ? 'Present' : 'Absent'}
                    </button>
                    {/* Hours input — present only */}
                    {p.present && (
                      <input
                        type="number" step="0.25" min="0" max="24" placeholder="hrs"
                        value={p.hours ?? ''}
                        onChange={e => setUploadPreview(prev => prev ? prev.map((x, j) => j === i ? { ...x, hours: e.target.value ? parseFloat(e.target.value) : null } : x) : prev)}
                        className={`${inp} w-16 text-center`}
                      />
                    )}
                    {/* Absence reason — absent only */}
                    {!p.present && (
                      <select
                        value={p.absent_reason ?? 'unpaid'}
                        onChange={e => setUploadPreview(prev => prev ? prev.map((x, j) => j === i ? { ...x, absent_reason: e.target.value } : x) : prev)}
                        className={`${inp} w-28`}>
                        {ABSENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    )}
                    {/* Note input */}
                    <input
                      type="text" placeholder="note…"
                      value={p.note ?? ''}
                      onChange={e => setUploadPreview(prev => prev ? prev.map((x, j) => j === i ? { ...x, note: e.target.value || null } : x) : prev)}
                      className={`${inp} flex-1 min-w-0`}
                    />
                  </div>
                ))}
              </div>

              {uploadShopDeds.length > 0 && (
                <div className="mb-3 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                  <p className="text-xs font-semibold text-orange-800 mb-1">Shop deductions found on timesheet</p>
                  {uploadShopDeds.map((d, i) => (
                    <p key={i} className="text-xs text-orange-700">
                      {fmtDate(d.date)} · R{d.amount.toFixed(2)}{d.note ? ` — ${d.note}` : ''}
                    </p>
                  ))}
                </div>
              )}

              {/* Override diff: show existing saved days that will be replaced */}
              {(() => {
                const willOverride = uploadPreview
                  ? [...importingSel].map(i => uploadPreview[i]).filter(p => {
                      const ex = days.find(d => d.date === p.date)
                      return ex && ex.id !== null // has a real saved record
                    })
                  : []
                return willOverride.length > 0 ? (
                  <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <p className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1">
                      <AlertTriangle size={11} /> These days already have saved data and will be overridden:
                    </p>
                    {willOverride.map((p, i) => {
                      const ex = days.find(d => d.date === p.date)!
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs text-amber-700">
                          <span className="w-24 font-medium">{fmtDate(p.date)}</span>
                          <span className="line-through text-amber-400">{ex.absent ? 'absent' : `${ex.hoursWorked ?? worker?.stdHoursPerDay}h`}</span>
                          <span>→</span>
                          <span className="font-medium">{!p.present ? 'absent' : `${p.hours ?? worker?.stdHoursPerDay}h`}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : null
              })()}

              <div className="flex gap-2">
                <button onClick={confirmImport}
                  className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
                  <Check size={14} /> Import {importingSel.size} days{uploadShopDeds.length > 0 ? ` + ${uploadShopDeds.length} deduction${uploadShopDeds.length > 1 ? 's' : ''}` : ''}
                </button>
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  Upload different photo
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PH confirmation banner */}
      {pendingPH.length > 0 && (
        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-orange-600" />
            <p className="text-sm font-medium text-orange-800">Public holiday confirmation needed</p>
          </div>
          <div className="space-y-1">
            {pendingPH.map(d => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="text-orange-700">{fmtDate(d.date)} — {d.holidayName}</span>
                <button onClick={() => saveDay(d, { phDoubleConfirmed: true })}
                  className="rounded-full bg-orange-600 px-3 py-0.5 text-xs text-white hover:bg-orange-700">
                  Pay double (×2)
                </button>
                <button onClick={() => saveDay(d, { phDoubleConfirmed: false })}
                  className="rounded-full border border-orange-300 px-3 py-0.5 text-xs text-orange-700 hover:bg-orange-100">
                  Normal pay
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Attendance grid ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Attendance</p>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Day</th>
                  <th className="px-3 py-2 text-center">
                    {worker.payStructure === 'hourly' ? 'Hours' : 'Present'}
                  </th>
                  <th className="px-3 py-2 text-center">Absent</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {days.map(day => {
                  const isSat = day.dayType === 'saturday'
                  const isPH  = day.dayType === 'public_holiday'
                  const isSun = day.dayType === 'sunday'
                  const isFloor = worker.payStructure === 'floor'

                  const rowCls = isPH  ? 'bg-orange-50' :
                                 isSat ? 'bg-blue-50'   :
                                 isSun ? 'bg-red-50'    : ''

                  const amount = day.calculatedAmount !== null
                    ? parseFloat(day.calculatedAmount)
                    : calcAmount(worker, day, day.phDoubleConfirmed === true)

                  return (
                    <tr key={`${day.date}-${day.hoursWorked ?? 'null'}-${day.id ?? 0}`} className={rowCls}>
                      <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                        {fmtDate(day.date)}
                        {isPH && (
                          <span className="ml-1 text-orange-600">
                            <Star size={9} className="inline" /> {day.holidayName}
                          </span>
                        )}
                        {day.source === 'photo_timesheet' && (
                          <span title="From timesheet upload">
                            <Camera size={10} className="inline ml-1 text-indigo-400" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500">
                        {new Date(day.date + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short' })}
                        {DAY_LABELS[day.dayType] && (
                          <span className={`ml-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${
                            isPH ? 'bg-orange-200 text-orange-800' :
                            isSat ? 'bg-blue-200 text-blue-800' :
                            'bg-red-200 text-red-800'
                          }`}>
                            {DAY_LABELS[day.dayType]}
                          </span>
                        )}
                      </td>

                      {/* Hours or present toggle */}
                      <td className="px-3 py-2 text-center">
                        {isLocked ? (
                          <span className="text-gray-600">
                            {worker.payStructure === 'hourly'
                              ? (day.absent ? '—' : (day.hoursWorked ?? worker.stdHoursPerDay))
                              : (day.absent ? '—' : (isFloor && !isSat ? 'Floor' : '✓'))}
                          </span>
                        ) : worker.payStructure === 'hourly' ? (
                          <input
                            type="number" step="0.25" min="0" max="24"
                            disabled={day.absent}
                            defaultValue={day.hoursWorked ?? worker.stdHoursPerDay ?? ''}
                            className={`${inp} w-16 text-center disabled:opacity-30`}
                            onBlur={e => {
                              if (e.target.value !== (day.hoursWorked ?? worker.stdHoursPerDay)) {
                                saveDay(day, { hoursWorked: e.target.value })
                              }
                            }}
                          />
                        ) : isFloor && !isSat ? (
                          <span className="text-gray-400 text-xs">Floor</span>
                        ) : (
                          <input type="checkbox"
                            checked={!day.absent}
                            disabled={isLocked}
                            onChange={e => saveDay(day, { absent: !e.target.checked })}
                            className="accent-gray-800 w-4 h-4" />
                        )}
                      </td>

                      {/* Absent */}
                      <td className="px-3 py-2 text-center">
                        {isLocked ? (
                          day.absent ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 text-xs">{day.absenceReason ?? 'absent'}</span> : null
                        ) : (
                          day.absent ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={day.absenceReason ?? 'unpaid'}
                                disabled={isLocked}
                                onChange={e => saveDay(day, { absent: true, absenceReason: e.target.value })}
                                className={`${inp} w-28`}>
                                {ABSENCE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                              <button
                                onClick={() => saveDay(day, { absent: false, absenceReason: null })}
                                title="Mark present"
                                className="rounded p-0.5 text-gray-300 hover:text-green-600 hover:bg-green-50 transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => saveDay(day, { absent: true, absenceReason: 'unpaid' })}
                              className="rounded px-2 py-0.5 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors text-xs">
                              Mark absent
                            </button>
                          )
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-3 py-2 text-right font-medium">
                        {day.absent ? <span className="text-gray-300">—</span>
                          : isFloor && !isSat ? <span className="text-gray-400 text-xs">in floor</span>
                          : <span className={amount > 0 ? 'text-gray-800' : 'text-gray-300'}>{amount > 0 ? fmt(amount) : '—'}</span>}
                      </td>

                      {/* Note */}
                      <td className="px-3 py-2 min-w-[7rem]">
                        {isLocked ? (
                          <span className="text-gray-400">{day.note ?? ''}</span>
                        ) : (
                          <input
                            type="text" placeholder="note…"
                            defaultValue={day.note ?? ''}
                            className={`${inp} w-28`}
                            onBlur={e => { if (e.target.value !== (day.note ?? '')) saveDay(day, { note: e.target.value }) }}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        {/* ── Right panel: summary + advances ────────────────────────────── */}
        <div className="space-y-4">
          {/* Pay summary */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pay Summary</p>
            {worker.payStructure === 'floor' && (
              <SummaryRow label="Floor salary"    value={fmt(parseFloat(worker.floorSalary ?? '0'))} />
            )}
            {saturdayExtra > 0 && (
              <SummaryRow label="Saturday top-ups" value={fmt(saturdayExtra)} />
            )}
            {worker.payStructure !== 'floor' && (
              <SummaryRow label="Attendance total" value={fmt(attendanceGross)} />
            )}
            <div className="border-t border-gray-100 pt-2">
              <SummaryRow label="Gross pay" value={fmt(grossPay)} bold />
            </div>
            {totalAdvances > 0 && <SummaryRow label="Salary advances" value={`-${fmt(totalAdvances)}`} red />}
            {totalShop     > 0 && <SummaryRow label="Shop deductions" value={`-${fmt(totalShop)}`}     red />}
            {worker.workerType === 'employee' && (
              <SummaryRow label="UIF (1%)" value={`-${fmt(Math.min(grossPay * 0.01, 177.12))}`} red />
            )}
            <div className="border-t border-gray-100 pt-2">
              <SummaryRow label="Est. net pay"
                value={fmt(Math.max(0, grossPay - totalDeds - (worker.workerType === 'employee' ? Math.min(grossPay * 0.01, 177.12) : 0)))}
                bold green />
            </div>
          </div>

          {/* Sign-off card */}
          {!isLocked && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Payroll Sign-off</p>
              {entry?.markedReady ? (
                <div className="flex items-center gap-2 text-xs text-green-700">
                  <Check size={14} className="text-green-600" />
                  <span>Payroll saved{entry.markedReadyAt ? ` · ${fmtDate(entry.markedReadyAt.slice(0, 10))}` : ''}</span>
                </div>
              ) : (
                <button
                  onClick={savePayroll}
                  disabled={markingSaved}
                  className="w-full rounded-lg bg-gray-900 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                  {markingSaved ? 'Saving…' : 'Save Payroll'}
                </button>
              )}
            </div>
          )}

          {/* Advances ledger */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Advances & Deductions</p>
              {!isLocked && (
                <button onClick={() => setShowAdvForm(v => !v)}
                  className="flex items-center gap-1 rounded-lg bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-700">
                  <Plus size={11} /> Add
                </button>
              )}
            </div>

            {showAdvForm && (
              <form onSubmit={addAdvance} className="p-3 border-b border-gray-100 bg-amber-50 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" required value={advForm.date}
                    onChange={e => setAdvForm(f => ({ ...f, date: e.target.value }))}
                    className={inp} />
                  <input type="number" step="0.01" required placeholder="Amount"
                    value={advForm.amount}
                    onChange={e => setAdvForm(f => ({ ...f, amount: e.target.value }))}
                    className={inp} />
                </div>
                <select value={advForm.advanceType}
                  onChange={e => setAdvForm(f => ({ ...f, advanceType: e.target.value }))}
                  className={`${inp} w-full`}>
                  <option value="cash_advance">Cash advance</option>
                  <option value="shop_deduction">Shop deduction</option>
                </select>
                <input type="text" placeholder="Note (optional)" value={advForm.note}
                  onChange={e => setAdvForm(f => ({ ...f, note: e.target.value }))}
                  className={`${inp} w-full`} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowAdvForm(false)}
                    className="flex-1 rounded border border-gray-200 py-1 text-xs text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={advSaving}
                    className="flex-1 rounded bg-gray-900 py-1 text-xs text-white disabled:opacity-50">
                    {advSaving ? 'Saving…' : 'Add'}
                  </button>
                </div>
              </form>
            )}

            {advances.length === 0 ? (
              <p className="px-4 py-4 text-xs text-gray-400">No advances or deductions yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {advances.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-2">
                    <div>
                      <p className="text-xs font-medium text-gray-800">
                        {a.advanceType === 'cash_advance' ? 'Cash advance' : 'Shop deduction'}
                      </p>
                      <p className="text-xs text-gray-400">{fmtDate(a.date)}{a.note ? ` · ${a.note}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-red-600">-{fmt(parseFloat(a.amount))}</span>
                      {!isLocked && (
                        <button onClick={() => deleteAdvance(a.id)}
                          className="rounded p-1 text-gray-300 hover:text-red-500 hover:bg-red-50">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="px-4 py-2 bg-gray-50 flex justify-between text-xs font-semibold text-gray-700">
                  <span>Total deductions</span>
                  <span className="text-red-600">-{fmt(totalAdvances + totalShop)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fix 6: footer navigation */}
      <div className="mt-8 pt-4 border-t border-gray-100 flex justify-between items-center">
        <Link href={`/dashboard/payroll/${runId}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Run #{runId}
        </Link>
        {nextWorker && (
          <Link href={`/dashboard/payroll/${runId}/attendance/${nextWorker.id}`}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700">
            Next: {nextWorker.name} →
          </Link>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value, bold, red, green }: {
  label: string; value: string; bold?: boolean; red?: boolean; green?: boolean
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-semibold' : ''} ${red ? 'text-red-600' : green ? 'text-green-700 text-sm' : 'text-gray-800'}`}>
        {value}
      </span>
    </div>
  )
}
