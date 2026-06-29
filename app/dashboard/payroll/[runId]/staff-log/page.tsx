'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { CheckCircle, SkipForward, ChevronDown } from 'lucide-react'

type Worker = { id: number; name: string; workerType: string; payStructure: string }
type Entry = {
  id: number
  workerName: string
  logType: string
  logDate: string
  message: string
  amount: string | null
  createdAt: string
  suggestedWorkerId: number | null
}
type Run = { id: number; periodStart: string; periodEnd: string; status: string }

const LOG_TYPE_STYLE: Record<string, string> = {
  hours:         'bg-blue-100 text-blue-800',
  advance:       'bg-amber-100 text-amber-800',
  shop_purchase: 'bg-orange-100 text-orange-800',
  note:          'bg-gray-100 text-gray-600',
}

const ACTION_OPTIONS = [
  { value: 'attendance', label: '→ Attendance (hours)' },
  { value: 'advance',    label: '→ Advance (cash)'     },
  { value: 'shop',       label: '→ Shop deduction'     },
  { value: 'skip',       label: 'Skip / dismiss'       },
]

function defaultAction(logType: string) {
  if (logType === 'hours')         return 'attendance'
  if (logType === 'advance')       return 'advance'
  if (logType === 'shop_purchase') return 'shop'
  return 'skip'
}

export default function StaffLogReviewPage() {
  const { runId } = useParams<{ runId: string }>()

  const [run,     setRun]     = useState<Run | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)

  // Per-row state: workerId, action, and amount override
  type RowState = { workerId: string; action: string; amount: string }
  const [rowState, setRowState] = useState<Record<number, RowState>>({})
  const [processing, setProcessing] = useState<Record<number, boolean>>({})
  const [done, setDone] = useState<Set<number>>(new Set())

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/payroll/${runId}/staff-log`)
      .then(r => r.json())
      .then(d => {
        setRun(d.run)
        setEntries(d.entries ?? [])
        setWorkers(d.workers ?? [])
        const init: Record<number, RowState> = {}
        for (const e of d.entries ?? []) {
          init[e.id] = {
            workerId: e.suggestedWorkerId ? String(e.suggestedWorkerId) : '',
            action: defaultAction(e.logType),
            amount: e.amount ?? '',
          }
        }
        setRowState(init)
        setLoading(false)
      })
  }, [runId])

  useEffect(() => { load() }, [load])

  function setRow(id: number, patch: Partial<RowState>) {
    setRowState(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function process(entry: Entry) {
    const row = rowState[entry.id]
    if (!row) return
    setProcessing(prev => ({ ...prev, [entry.id]: true }))

    await fetch(`/api/payroll/${runId}/staff-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entryId:  entry.id,
        workerId: row.workerId ? parseInt(row.workerId) : null,
        action:   row.action,
        amount:   row.amount !== '' ? row.amount : undefined,
      }),
    })

    setProcessing(prev => ({ ...prev, [entry.id]: false }))
    setDone(prev => new Set(prev).add(entry.id))
  }

  async function processAll() {
    const pending = entries.filter(e => !done.has(e.id))
    for (const e of pending) await process(e)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  const pending = entries.filter(e => !done.has(e.id))
  const inp = 'rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 bg-white'

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-1 text-sm text-gray-400">
        <Link href="/dashboard/payroll" className="hover:text-gray-600">Payroll</Link>
        <span>/</span>
        <Link href={`/dashboard/payroll/${runId}`} className="hover:text-gray-600">Run #{runId}</Link>
        <span>/</span>
        <span className="text-gray-600">Staff Log Review</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Staff Log Review</h1>
          {run && (
            <p className="text-sm text-gray-400 mt-0.5">
              {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)} · {pending.length} pending
            </p>
          )}
        </div>
        {pending.length > 0 && (
          <button onClick={processAll}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            Process All
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-400">No unprocessed staff log entries.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => {
            const isDone = done.has(entry.id)
            const row    = rowState[entry.id] ?? { workerId: '', action: 'skip' }

            return (
              <div key={entry.id}
                className={`rounded-xl border p-4 transition-all ${isDone ? 'border-green-200 bg-green-50 opacity-60' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start gap-4">
                  {/* Log info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LOG_TYPE_STYLE[entry.logType] ?? 'bg-gray-100 text-gray-600'}`}>
                        {entry.logType.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-400">{fmtDate(entry.logDate)}</span>
                      {entry.amount && (
                        <span className="text-xs font-medium text-amber-700">R{entry.amount}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 font-medium">{entry.workerName}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{entry.message}</p>
                  </div>

                  {/* Controls */}
                  {!isDone ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <select className={inp} value={row.workerId}
                        onChange={e => setRow(entry.id, { workerId: e.target.value })}>
                        <option value="">Match worker…</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>

                      <select className={inp} value={row.action}
                        onChange={e => setRow(entry.id, { action: e.target.value })}>
                        {ACTION_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>

                      {(row.action === 'advance' || row.action === 'shop') && (
                        <input
                          type="number" step="0.01" min="0" placeholder="Amount"
                          value={row.amount}
                          onChange={e => setRow(entry.id, { amount: e.target.value })}
                          className={`${inp} w-28`}
                        />
                      )}

                      <button
                        onClick={() => process(entry)}
                        disabled={processing[entry.id]}
                        className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                        {processing[entry.id] ? '…' : <><CheckCircle size={13} /> Apply</>}
                      </button>
                    </div>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-green-700 font-medium shrink-0">
                      <CheckCircle size={14} /> Done
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
