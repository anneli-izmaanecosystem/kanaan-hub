'use client'

import { useRef, useState } from 'react'
import { Upload, Check, X, AlertTriangle, ChevronDown, ChevronUp, Loader, Plus, Trash2 } from 'lucide-react'
import { fmt, fmtDate } from '@/lib/utils'

type ParsedDay = {
  date: string; present: boolean; hours: number | null
  absent_reason: string | null; note: string | null
}
type ParsedDed = { date: string; amount: number; note: string | null }
type WorkerResult = {
  filename: string; workerName: string; workerId: number | null; matched: boolean
  days: ParsedDay[]; shop_deductions: ParsedDed[]; warnings: string[]; error?: string
}
type AllWorker = { id: number; name: string; payStructure: string; stdHoursPerDay: string | null }
type ExistingDay = { date: string; hoursWorked: string | null; absent: boolean; source: string }
type ExistingMap = Record<number, ExistingDay[]> // workerId → existing non-default days

const inp = 'rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300'

export default function BulkUploadPanel({ runId, onDone }: { runId: string; onDone: () => void }) {
  const fileRef    = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [results,    setResults]    = useState<WorkerResult[] | null>(null)
  const [allWorkers, setAllWorkers] = useState<AllWorker[]>([])
  const [error,      setError]      = useState('')
  const [importing,  setImporting]  = useState(false)
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())
  const [overrides,  setOverrides]  = useState<Record<string, number>>({})
  const [imported,   setImported]   = useState<{ name: string; days: number; deds: number }[] | null>(null)
  const [existingMap, setExistingMap] = useState<ExistingMap>({})

  // ── helpers to mutate results in place ──────────────────────────────────────
  function updateDay(filename: string, idx: number, patch: Partial<ParsedDay>) {
    setResults(prev => prev?.map(r =>
      r.filename !== filename ? r : {
        ...r, days: r.days.map((d, i) => i === idx ? { ...d, ...patch } : d)
      }
    ) ?? null)
  }

  function removeDay(filename: string, idx: number) {
    setResults(prev => prev?.map(r =>
      r.filename !== filename ? r : { ...r, days: r.days.filter((_, i) => i !== idx) }
    ) ?? null)
  }

  function updateDed(filename: string, idx: number, patch: Partial<ParsedDed>) {
    setResults(prev => prev?.map(r =>
      r.filename !== filename ? r : {
        ...r, shop_deductions: r.shop_deductions.map((d, i) => i === idx ? { ...d, ...patch } : d)
      }
    ) ?? null)
  }

  function removeDed(filename: string, idx: number) {
    setResults(prev => prev?.map(r =>
      r.filename !== filename ? r : { ...r, shop_deductions: r.shop_deductions.filter((_, i) => i !== idx) }
    ) ?? null)
  }

  function addDed(filename: string, periodStart: string) {
    setResults(prev => prev?.map(r =>
      r.filename !== filename ? r : {
        ...r, shop_deductions: [...r.shop_deductions, { date: periodStart, amount: 0, note: '' }]
      }
    ) ?? null)
  }

  // ── upload handler ────────────────────────────────────────────────────────────
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProcessing(true); setError(''); setResults(null); setOverrides({})

    const fd = new FormData()
    fd.append('file', file)
    const res  = await fetch(`/api/payroll/${runId}/bulk-upload`, { method: 'POST', body: fd })
    const data = await res.json()

    if (!res.ok) { setError(data.error ?? 'Upload failed'); setProcessing(false); return }
    setResults(data.results)
    setAllWorkers(data.runWorkers ?? [])
    // Auto-expand unmatched so user sees them
    const unmatched = new Set<string>(
      data.results.filter((r: WorkerResult) => !r.matched).map((r: WorkerResult) => r.filename)
    )
    setExpanded(unmatched)

    // Fetch existing attendance for each matched worker to detect overrides
    const matchedWorkerIds: number[] = Array.from(new Set(
      data.results
        .filter((r: WorkerResult) => r.matched && r.workerId)
        .map((r: WorkerResult) => r.workerId as number)
    ))
    if (matchedWorkerIds.length > 0) {
      const responses = await Promise.all(
        matchedWorkerIds.map((wid: number) =>
          fetch(`/api/payroll/${runId}/attendance/${wid}`).then(r => r.json())
        )
      )
      const map: ExistingMap = {}
      responses.forEach((att, i) => {
        const wid = matchedWorkerIds[i]
        // Only flag days that are actually saved (have an id) and aren't just defaults
        const realDays: ExistingDay[] = (att.days ?? []).filter(
          (d: any) => d.id !== null && d.source !== 'default'
        )
        if (realDays.length > 0) map[wid] = realDays
      })
      setExistingMap(map)
    }

    setProcessing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── override summary ──────────────────────────────────────────────────────────
  function getOverridingWorkers() {
    if (!results) return []
    return matched.filter(r => {
      const wid = overrides[r.filename] ?? r.workerId
      return wid && existingMap[wid] && existingMap[wid].length > 0
    })
  }

  // ── import handler ────────────────────────────────────────────────────────────
  async function confirmImport() {
    if (!results) return
    setImporting(true)

    for (const result of results) {
      const wid = overrides[result.filename] ?? result.workerId
      if (!wid) continue

      const worker = allWorkers.find(w => w.id === wid)
      const workerIsHourly = !worker || worker.payStructure === 'hourly'

      // Save attendance days in parallel
      await Promise.all(result.days.map(day =>
        fetch(`/api/payroll/${runId}/attendance/${wid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date:          day.date,
            absent:        !day.present,
            absenceReason: day.absent_reason ?? null,
            // Only save hours for hourly workers — daily/floor workers get presence only
            // Use '0' when hours not parsed so user can see and correct it manually
            hoursWorked:   workerIsHourly && day.present
                             ? (day.hours != null ? String(day.hours) : '0')
                             : null,
            note:          day.note ?? null,
            source:        'photo_timesheet',
          }),
        })
      ))

      // Save shop deductions in parallel
      await Promise.all(result.shop_deductions
        .filter(ded => ded.amount > 0)
        .map(ded => fetch(`/api/payroll/${runId}/advances/${wid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date:        ded.date,
            amount:      String(ded.amount),
            advanceType: 'shop_deduction',
            note:        ded.note || 'from timesheet',
          }),
        }))
      )

      // Recalculate payroll entry from saved attendance + advances
      await fetch(`/api/payroll/${runId}/attendance/${wid}/sync`, { method: 'POST' })
    }

    // Build success summary before clearing
    const summary = matched.map(r => {
      const wid = overrides[r.filename] ?? r.workerId
      const worker = allWorkers.find(w => w.id === wid)
      return {
        name: worker?.name ?? r.workerName,
        days: r.days.filter(d => d.present).length,
        deds: r.shop_deductions.filter(d => d.amount > 0).length,
      }
    })

    setResults(null); setImporting(false)
    setImported(summary)
    onDone()
  }

  // ── derived counts ────────────────────────────────────────────────────────────
  const matched    = results?.filter(r => !r.error && (r.matched || overrides[r.filename])) ?? []
  const unmatched  = results?.filter(r => !r.error && !r.matched && !overrides[r.filename]) ?? []
  const errored    = results?.filter(r => !!r.error) ?? []
  const totalDays  = matched.reduce((s, r) => s + r.days.filter(d => d.present).length, 0)
  const totalDeds  = matched.reduce((s, r) => s + r.shop_deductions.filter(d => d.amount > 0).length, 0)

  // Need period start for new deduction date default
  const periodStart = results?.[0]?.days?.[0]?.date ?? new Date().toISOString().slice(0, 10)

  return (
    <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Upload size={15} className="text-indigo-600" />
          <p className="text-sm font-semibold text-indigo-900">Bulk timesheet import</p>
        </div>
        {results && (
          <button onClick={() => setResults(null)} className="text-indigo-400 hover:text-indigo-700">
            <X size={16} />
          </button>
        )}
      </div>

      {imported && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-800 flex items-center gap-2">
            <Check size={15} className="text-green-600" /> Imported successfully
          </p>
          <div className="rounded-lg bg-white border border-green-100 divide-y divide-gray-50">
            {imported.map((r, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="font-medium text-gray-800">{r.name}</span>
                <span className="text-gray-400">
                  {r.days > 0 && `${r.days}d attendance`}
                  {r.days > 0 && r.deds > 0 && ' · '}
                  {r.deds > 0 && `${r.deds} deduction${r.deds > 1 ? 's' : ''}`}
                  {r.days === 0 && r.deds === 0 && 'skipped'}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setImported(null)}
            className="flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-100 transition-colors">
            <Upload size={14} /> Upload another zip
          </button>
        </div>
      )}

      {!imported && !results && !processing && (
        <>
          <p className="text-xs text-indigo-700 mb-3">
            Upload a zip of all timesheet photos. Claude reads each sheet, identifies the worker, and imports attendance + shop deductions. Review and edit before confirming.
          </p>
          <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border border-dashed border-indigo-300 px-4 py-2.5 text-sm text-indigo-600 hover:border-indigo-500 hover:bg-indigo-100 transition-colors">
            <Upload size={14} /> Choose zip file…
          </button>
        </>
      )}

      {processing && (
        <div className="flex items-center gap-3 py-4">
          <Loader size={16} className="text-indigo-600 animate-spin" />
          <p className="text-sm text-indigo-700">Reading timesheets with Claude… this may take 30–60 seconds</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {results && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="rounded-lg bg-white border border-indigo-100 px-4 py-3 flex items-center gap-6 text-sm">
            <span className="text-gray-500">{results.length} sheets read</span>
            <span className="text-green-700 font-medium">{matched.length} matched</span>
            {unmatched.length > 0 && <span className="text-amber-700 font-medium">{unmatched.length} unmatched</span>}
            {errored.length  > 0 && <span className="text-red-600 font-medium">{errored.length} errors</span>}
          </div>

          {/* Unmatched — assign worker */}
          {unmatched.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1">
                <AlertTriangle size={12} /> Unmatched sheets — assign a worker
              </p>
              {unmatched.map(r => (
                <div key={r.filename} className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-amber-700 w-40 truncate" title={r.filename}>
                    {r.workerName || r.filename}
                  </span>
                  <select
                    value={overrides[r.filename] ?? ''}
                    onChange={e => setOverrides(prev => ({ ...prev, [r.filename]: parseInt(e.target.value) }))}
                    className="rounded border border-amber-300 px-2 py-1 text-xs focus:outline-none flex-1">
                    <option value="">— skip —</option>
                    {allWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Result cards */}
          <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
            {results.filter(r => !r.error).map(r => {
              const wid        = overrides[r.filename] ?? r.workerId
              const isOpen     = expanded.has(r.filename)
              const dPresent   = r.days.filter(d => d.present).length
              const dAbsent    = r.days.filter(d => !d.present).length
              const deds       = r.shop_deductions.filter(d => d.amount > 0)
              const existing   = wid ? existingMap[wid] : undefined
              const hasExisting = existing && existing.length > 0
              const workerMeta = allWorkers.find(w => w.id === wid)
              const isHourly   = !workerMeta || workerMeta.payStructure === 'hourly'

              return (
                <div key={r.filename} className={`rounded-lg bg-white border overflow-hidden ${hasExisting ? 'border-amber-300' : 'border-gray-200'}`}>
                  {/* Row header */}
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      onClick={() => setExpanded(prev => {
                        const n = new Set(prev); isOpen ? n.delete(r.filename) : n.add(r.filename); return n
                      })}
                      className="flex items-center gap-3 flex-1 text-left hover:opacity-80">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${wid ? 'bg-green-500' : 'bg-amber-400'}`} />
                      <span className="text-sm font-medium text-gray-800">{r.workerName || '(unknown)'}</span>
                      <span className="text-xs text-gray-400">
                        {dPresent > 0 && `${dPresent}d present`}
                        {dAbsent  > 0 && ` · ${dAbsent}d absent`}
                        {deds.length  > 0 && ` · ${deds.length} deduction${deds.length > 1 ? 's' : ''}`}
                      </span>
                      {hasExisting && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 flex-shrink-0">
                          <AlertTriangle size={10} /> overrides {existing!.length}d
                        </span>
                      )}
                      {r.warnings.length > 0 && <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />}
                    </button>
                    {/* Inline worker reassignment */}
                    <select
                      value={overrides[r.filename] ?? r.workerId ?? ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setOverrides(prev => ({ ...prev, [r.filename]: parseInt(e.target.value) }))}
                      className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-300 max-w-[160px]">
                      <option value="">— skip —</option>
                      {allWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    {isOpen ? <ChevronUp size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />}
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 p-3 space-y-3">
                      {/* Override diff — show what will be replaced */}
                      {hasExisting && (
                        <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2">
                          <p className="text-xs font-semibold text-amber-800 mb-1.5">
                            Existing attendance that will be overridden:
                          </p>
                          <div className="space-y-0.5 max-h-32 overflow-y-auto">
                            {existing!.map((d, i) => {
                              const incoming = r.days.find(p => p.date === d.date)
                              const oldHrs = d.absent ? 'absent' : (d.hoursWorked ?? 'default')
                              const newHrs = !incoming ? '(not in new sheet)'
                                : !incoming.present ? 'absent'
                                : incoming.hours != null ? `${incoming.hours}h`
                                : 'default h'
                              return (
                                <div key={i} className="flex items-center gap-2 text-xs text-amber-700">
                                  <span className="w-20 flex-shrink-0 font-medium">{fmtDate(d.date)}</span>
                                  <span className="line-through text-amber-400">{oldHrs}</span>
                                  <span>→</span>
                                  <span className="font-medium">{newHrs}</span>
                                  <span className="text-amber-400 text-xs">[{d.source}]</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Warnings */}
                      {r.warnings.length > 0 && (
                        <div className="rounded bg-amber-50 border border-amber-100 px-3 py-2">
                          {r.warnings.map((w, i) => (
                            <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
                          ))}
                        </div>
                      )}

                      {/* Attendance days */}
                      {r.days.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Attendance</p>
                          <div className="space-y-1">
                            {r.days.map((d, i) => (
                              <div key={i} className="flex items-center gap-2">
                                {/* Present toggle */}
                                <input type="checkbox" checked={d.present}
                                  onChange={e => updateDay(r.filename, i, { present: e.target.checked })}
                                  className="accent-green-600 w-3.5 h-3.5 flex-shrink-0" />
                                {/* Date */}
                                <span className="text-xs text-gray-500 w-22 flex-shrink-0">{fmtDate(d.date)}</span>
                                {/* Hours — only for hourly workers */}
                                {d.present && isHourly && (
                                  <input type="number" step="0.5" min="0" max="24"
                                    value={d.hours ?? ''}
                                    placeholder="hrs"
                                    onChange={e => updateDay(r.filename, i, { hours: e.target.value ? parseFloat(e.target.value) : null })}
                                    className={`${inp} w-16 text-center`} />
                                )}
                                {d.present && !isHourly && (
                                  <span className="text-xs text-gray-400 w-16 text-center">daily</span>
                                )}
                                {!d.present && (
                                  <select value={d.absent_reason ?? 'unpaid'}
                                    onChange={e => updateDay(r.filename, i, { absent_reason: e.target.value })}
                                    className={`${inp} w-28`}>
                                    <option value="sick">Sick leave</option>
                                    <option value="annual_leave">Annual leave</option>
                                    <option value="unpaid">Unpaid</option>
                                    <option value="other">Other</option>
                                  </select>
                                )}
                                {/* Note */}
                                <input type="text" value={d.note ?? ''} placeholder="note…"
                                  onChange={e => updateDay(r.filename, i, { note: e.target.value || null })}
                                  className={`${inp} flex-1 min-w-0`} />
                                {/* Remove */}
                                <button onClick={() => removeDay(r.filename, i)}
                                  className="text-gray-300 hover:text-red-500 flex-shrink-0">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Shop deductions */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Shop Deductions</p>
                          <button onClick={() => addDed(r.filename, periodStart)}
                            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
                            <Plus size={11} /> Add
                          </button>
                        </div>
                        {r.shop_deductions.length === 0 && (
                          <p className="text-xs text-gray-400 italic">None</p>
                        )}
                        <div className="space-y-1">
                          {r.shop_deductions.map((ded, i) => (
                            <div key={i} className="flex items-center gap-2">
                              {/* Date */}
                              <input type="date" value={ded.date}
                                onChange={e => updateDed(r.filename, i, { date: e.target.value })}
                                className={`${inp} w-32 flex-shrink-0`} />
                              {/* Amount */}
                              <span className="text-xs text-gray-400 flex-shrink-0">R</span>
                              <input type="number" step="0.01" min="0"
                                value={ded.amount || ''}
                                placeholder="0.00"
                                onChange={e => updateDed(r.filename, i, { amount: parseFloat(e.target.value) || 0 })}
                                className={`${inp} w-24 text-right`} />
                              {/* Note */}
                              <input type="text" value={ded.note ?? ''} placeholder="description…"
                                onChange={e => updateDed(r.filename, i, { note: e.target.value || null })}
                                className={`${inp} flex-1 min-w-0`} />
                              {/* Remove */}
                              <button onClick={() => removeDed(r.filename, i)}
                                className="text-gray-300 hover:text-red-500 flex-shrink-0">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {errored.map(r => (
              <div key={r.filename} className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
                {r.filename}: {r.error}
              </div>
            ))}
          </div>

          {/* Import button */}
          {(() => {
            const overridingWorkers = getOverridingWorkers()
            const hasOverrides = overridingWorkers.length > 0
            return (
              <div className="space-y-2 pt-1">
                {hasOverrides && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2 text-xs text-amber-800">
                    <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>{overridingWorkers.length} worker{overridingWorkers.length > 1 ? 's' : ''}</strong> already have saved attendance.
                      Importing will override it with the new timesheet data.
                      Expand each card above to review the diff.
                    </span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={confirmImport}
                    disabled={importing || matched.length === 0}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                      hasOverrides ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-700 hover:bg-indigo-800'
                    }`}>
                    {importing
                      ? <><Loader size={14} className="animate-spin" /> Importing…</>
                      : hasOverrides
                      ? <><AlertTriangle size={14} /> Override &amp; Import {matched.length} workers · {totalDays} days{totalDeds > 0 ? ` + ${totalDeds} deductions` : ''}</>
                      : <><Check size={14} /> Import {matched.length} workers · {totalDays} days{totalDeds > 0 ? ` + ${totalDeds} deductions` : ''}</>}
                  </button>
                  <button onClick={() => fileRef.current?.click()} disabled={processing}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    Upload different zip
                  </button>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
