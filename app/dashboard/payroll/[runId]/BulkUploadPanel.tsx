'use client'

import { useRef, useState } from 'react'
import { Upload, Check, X, AlertTriangle, ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { fmt, fmtDate } from '@/lib/utils'
import { round2 } from '@/lib/payroll'

type ParsedDay = {
  date: string; present: boolean; hours: number | null
  absent_reason: string | null; note: string | null
}
type ParsedDed = { date: string; amount: number; note: string | null }
type WorkerResult = {
  filename: string; workerName: string; workerId: number | null; matched: boolean
  days: ParsedDay[]; shop_deductions: ParsedDed[]; warnings: string[]; error?: string
}
type RunWorker = { id: number; name: string; stdHoursPerDay: string | null }

export default function BulkUploadPanel({ runId, onDone }: { runId: string; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [processing, setProcessing] = useState(false)
  const [results,    setResults]    = useState<WorkerResult[] | null>(null)
  const [runWorkers, setRunWorkers] = useState<RunWorker[]>([])
  const [error,      setError]      = useState('')
  const [importing,  setImporting]  = useState(false)
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set())

  // Per-result worker override (for unmatched sheets)
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProcessing(true); setError(''); setResults(null)

    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`/api/payroll/${runId}/bulk-upload`, { method: 'POST', body: fd })
    const data = await res.json()

    if (!res.ok) { setError(data.error ?? 'Upload failed'); setProcessing(false); return }
    setResults(data.results)
    setRunWorkers(data.runWorkers ?? [])
    // Auto-expand unmatched results so user sees them
    const unmatched = new Set<string>(data.results.filter((r: WorkerResult) => !r.matched).map((r: WorkerResult) => r.filename))
    setExpanded(unmatched)
    setProcessing(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function confirmImport() {
    if (!results) return
    setImporting(true)

    for (const result of results) {
      const wid = overrides[result.filename] ?? result.workerId
      if (!wid) continue // skip unmatched with no override

      // Save attendance days
      for (const day of result.days) {
        const worker = runWorkers.find(w => w.id === wid)
        await fetch(`/api/payroll/${runId}/attendance/${wid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date:          day.date,
            absent:        !day.present,
            absenceReason: day.absent_reason ?? null,
            hoursWorked:   day.hours != null ? String(day.hours)
                           : (!day.present ? null : (worker?.stdHoursPerDay ?? null)),
            note:          day.note ?? null,
            source:        'timesheet_photo',
          }),
        })
      }

      // Save shop deductions
      for (const ded of result.shop_deductions) {
        await fetch(`/api/payroll/${runId}/advances/${wid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date:        ded.date,
            amount:      String(ded.amount),
            advanceType: 'shop_deduction',
            note:        ded.note ?? 'from timesheet',
          }),
        })
      }
    }

    setResults(null)
    setImporting(false)
    onDone()
  }

  const matched   = results?.filter(r => r.matched || overrides[r.filename]) ?? []
  const unmatched = results?.filter(r => !r.matched && !overrides[r.filename]) ?? []
  const errored   = results?.filter(r => !!r.error) ?? []
  const totalDays = matched.reduce((s, r) => s + r.days.filter(d => d.present).length, 0)
  const totalDeds = matched.reduce((s, r) => s + r.shop_deductions.length, 0)

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

      {!results && !processing && (
        <>
          <p className="text-xs text-indigo-700 mb-3">
            Upload a zip file containing all timesheet photos. Claude will read each sheet, identify the worker, and import attendance + shop deductions automatically.
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
          {/* Summary */}
          <div className="rounded-lg bg-white border border-indigo-100 px-4 py-3 flex items-center gap-6 text-sm">
            <span className="text-gray-500">{results.length} sheets read</span>
            <span className="text-green-700 font-medium">{matched.length} matched</span>
            {unmatched.length > 0 && <span className="text-amber-700 font-medium">{unmatched.length} unmatched</span>}
            {errored.length  > 0 && <span className="text-red-600 font-medium">{errored.length} errors</span>}
          </div>

          {/* Unmatched — need worker override */}
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
                    {runWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Results list */}
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {results.filter(r => !r.error).map(r => {
              const wid      = overrides[r.filename] ?? r.workerId
              const isOpen   = expanded.has(r.filename)
              const daysPresent = r.days.filter(d => d.present).length
              const daysAbsent  = r.days.filter(d => !d.present).length

              return (
                <div key={r.filename} className="rounded-lg bg-white border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => setExpanded(prev => {
                      const n = new Set(prev)
                      isOpen ? n.delete(r.filename) : n.add(r.filename)
                      return n
                    })}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${wid ? 'bg-green-500' : 'bg-amber-400'}`} />
                      <span className="text-sm font-medium text-gray-800">{r.workerName || '(unknown)'}</span>
                      <span className="text-xs text-gray-400">
                        {daysPresent}d present{daysAbsent > 0 ? `, ${daysAbsent}d absent` : ''}
                        {r.shop_deductions.length > 0 && ` · ${r.shop_deductions.length} deduction${r.shop_deductions.length > 1 ? 's' : ''}`}
                      </span>
                      {r.warnings.length > 0 && <AlertTriangle size={12} className="text-amber-500" />}
                    </div>
                    {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                      {r.warnings.length > 0 && (
                        <div className="rounded bg-amber-50 px-2 py-1 mb-2">
                          {r.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">⚠ {w}</p>)}
                        </div>
                      )}
                      {r.days.map((d, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="w-24 text-gray-500">{fmtDate(d.date)}</span>
                          {d.present
                            ? <span className="text-green-700">Present{d.hours != null ? ` · ${d.hours}h` : ''}</span>
                            : <span className="text-red-500">Absent{d.absent_reason ? ` (${d.absent_reason.replace('_', ' ')})` : ''}</span>}
                          {d.note && <span className="text-gray-400">— {d.note}</span>}
                        </div>
                      ))}
                      {r.shop_deductions.map((d, i) => (
                        <div key={`ded-${i}`} className="flex items-center gap-3 text-xs text-orange-700">
                          <span className="w-24">{fmtDate(d.date)}</span>
                          <span>Shop deduction · {fmt(d.amount)}{d.note ? ` — ${d.note}` : ''}</span>
                        </div>
                      ))}
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
          <div className="flex gap-2 pt-1">
            <button onClick={confirmImport} disabled={importing || matched.length === 0}
              className="flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
              {importing
                ? <><Loader size={14} className="animate-spin" /> Importing…</>
                : <><Check size={14} /> Import {matched.length} workers · {totalDays} days{totalDeds > 0 ? ` + ${totalDeds} deductions` : ''}</>}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={processing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Upload different zip
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
