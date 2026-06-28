'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { Trash2, Plus, Clock, Calendar, ChevronRight } from 'lucide-react'

type Worker = {
  id: number; name: string; workerType: string; payStructure: string
  hourlyRate: string | null; stdHoursPerDay: string | null
  dailyRate: string | null; floorSalary: string | null
  department: string | null; position: string | null
}
type Entry = {
  id: number; workerId: number
  usesTimesheet: boolean
  defaultHoursPerDay: string | null
  defaultDaysInPeriod: number | null
  defaultsApplied: boolean
}
type Run = { id: number; periodStart: string; periodEnd: string; status: string; entityId: number }

type WorkerConfig = {
  entryId: number
  workerId: number
  worker: Worker
  usesTimesheet: boolean
  defaultHoursPerDay: string
  defaultDaysInPeriod: number
  remove: boolean
}

const PAY_BADGE: Record<string, string> = {
  hourly: 'bg-blue-100 text-blue-700',
  daily:  'bg-green-100 text-green-700',
  floor:  'bg-amber-100 text-amber-800',
}

export default function SetupPage() {
  const { runId } = useParams<{ runId: string }>()
  const router    = useRouter()

  const [run,        setRun]        = useState<Run | null>(null)
  const [configs,    setConfigs]    = useState<WorkerConfig[]>([])
  const [allWorkers, setAllWorkers] = useState<Worker[]>([])
  const [weekdays,   setWeekdays]   = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [showAdd,    setShowAdd]    = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/payroll/${runId}/setup`)
      .then(r => r.json())
      .then(d => {
        setRun(d.run)
        setWeekdays(d.weekdays)
        setAllWorkers(d.allWorkers ?? [])
        const cfgs: WorkerConfig[] = (d.entries ?? []).map(({ entry, worker }: { entry: Entry; worker: Worker }) => ({
          entryId:           entry.id,
          workerId:          worker.id,
          worker,
          usesTimesheet:     entry.usesTimesheet,
          defaultHoursPerDay:  entry.defaultHoursPerDay ?? worker.stdHoursPerDay ?? '6.5',
          defaultDaysInPeriod: entry.defaultDaysInPeriod ?? d.weekdays,
          remove:            false,
        }))
        setConfigs(cfgs)
        setLoading(false)
      })
  }, [runId])

  useEffect(() => { load() }, [load])

  function update(workerId: number, patch: Partial<WorkerConfig>) {
    setConfigs(prev => prev.map(c => c.workerId === workerId ? { ...c, ...patch } : c))
  }

  function addWorker(worker: Worker) {
    if (configs.find(c => c.workerId === worker.id)) return
    setConfigs(prev => [...prev, {
      entryId: -worker.id, // negative = new, not yet in DB
      workerId: worker.id,
      worker,
      usesTimesheet: true,
      defaultHoursPerDay: worker.stdHoursPerDay ?? '6.5',
      defaultDaysInPeriod: weekdays,
      remove: false,
    }])
    setShowAdd(false)
  }

  async function handleApply() {
    setSaving(true)
    const workerConfigs = configs.map(c => ({
      entryId:           c.entryId > 0 ? c.entryId : undefined,
      workerId:          c.workerId,
      remove:            c.remove,
      usesTimesheet:     c.usesTimesheet,
      defaultHoursPerDay:  c.usesTimesheet ? null : parseFloat(c.defaultHoursPerDay) || null,
      defaultDaysInPeriod: c.usesTimesheet ? null : c.defaultDaysInPeriod,
    }))

    const addWorkerIds = configs
      .filter(c => c.entryId < 0 && !c.remove)
      .map(c => c.workerId)

    await fetch(`/api/payroll/${runId}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerConfigs, addWorkerIds }),
    })

    router.push(`/dashboard/payroll/${runId}`)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!run)    return <div className="p-8 text-sm text-red-500">Run not found.</div>

  const active    = configs.filter(c => !c.remove)
  const removed   = configs.filter(c => c.remove)
  const available = allWorkers.filter(w => !configs.find(c => c.workerId === w.id && !c.remove))

  const inp = 'rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-1 text-sm text-gray-400">
        <Link href="/dashboard/payroll" className="hover:text-gray-600">Payroll</Link>
        <span>/</span>
        <span className="text-gray-600">Run #{runId} — Setup</span>
      </div>

      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Confirm Workers</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)} · {weekdays} weekdays
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Plus size={14} /> Add Worker
          </button>
          <button onClick={handleApply} disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Applying…' : 'Apply & Continue'} <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Explainer */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 mb-6">
        For workers <strong>not on timesheets</strong>, set their default hours/days — attendance will be auto-filled for the period.
        Manual absences or changes entered via the app or attendance page will override the defaults.
      </div>

      {/* Add worker panel */}
      {showAdd && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Add from master list</p>
          {available.length === 0
            ? <p className="text-sm text-gray-400">All workers from this entity are already included.</p>
            : (
              <div className="grid grid-cols-2 gap-2">
                {available.map(w => (
                  <button key={w.id} onClick={() => addWorker(w)}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-gray-400 text-left">
                    <span>
                      <span className="font-medium text-gray-900">{w.name}</span>
                      <span className="ml-2 text-xs text-gray-400">{w.payStructure}</span>
                    </span>
                    <Plus size={14} className="text-gray-400" />
                  </button>
                ))}
              </div>
            )}
        </div>
      )}

      {/* Worker rows */}
      <div className="space-y-3">
        {active.map(cfg => {
          const w = cfg.worker
          const isHourly = w.payStructure === 'hourly'
          const isFloor  = w.payStructure === 'floor'

          return (
            <div key={cfg.workerId}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                {/* Worker info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900">{w.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAY_BADGE[w.payStructure] ?? 'bg-gray-100 text-gray-600'}`}>
                      {w.payStructure}
                    </span>
                    <span className="text-xs text-gray-400 capitalize">{w.workerType}</span>
                    {w.position && <span className="text-xs text-gray-400">· {w.position}</span>}
                  </div>
                  {isHourly && <p className="text-xs text-gray-400 mt-0.5">R{w.hourlyRate}/hr · std {w.stdHoursPerDay}h/day</p>}
                  {w.payStructure === 'daily' && <p className="text-xs text-gray-400 mt-0.5">R{w.dailyRate}/day</p>}
                  {isFloor && <p className="text-xs text-gray-400 mt-0.5">R{w.floorSalary} floor + R{(w as any).saturdayRate}/Sat</p>}
                </div>

                {/* Remove */}
                <button onClick={() => update(w.id, { remove: true })}
                  className="rounded-lg p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>

              {/* Timesheet toggle */}
              <div className="mt-4 flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => update(w.id, { usesTimesheet: true })}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                      cfg.usesTimesheet
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    <Clock size={12} /> Timesheet
                  </button>
                  <button
                    onClick={() => update(w.id, { usesTimesheet: false })}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                      !cfg.usesTimesheet
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    <Calendar size={12} /> Default hours
                  </button>
                </div>

                {/* Default inputs (non-timesheet only) */}
                {!cfg.usesTimesheet && !isFloor && (
                  <div className="flex items-center gap-4 flex-wrap">
                    {isHourly && (
                      <label className="flex items-center gap-2 text-sm text-gray-600">
                        Hours/day
                        <input type="number" step="0.5" min="1" max="12"
                          className={`${inp} w-20 text-right`}
                          value={cfg.defaultHoursPerDay}
                          onChange={e => update(w.id, { defaultHoursPerDay: e.target.value })} />
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      Days this month
                      <input type="number" min="1" max="31"
                        className={`${inp} w-20 text-right`}
                        value={cfg.defaultDaysInPeriod}
                        onChange={e => update(w.id, { defaultDaysInPeriod: parseInt(e.target.value) || weekdays })} />
                    </label>
                    <p className="text-xs text-gray-400">({weekdays} weekdays in period)</p>
                  </div>
                )}

                {!cfg.usesTimesheet && isFloor && (
                  <p className="text-xs text-gray-500 italic">
                    Weekdays covered by floor salary. Saturdays confirmed on attendance page.
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Removed workers */}
      {removed.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Removed from this run</p>
          <div className="flex flex-wrap gap-2">
            {removed.map(cfg => (
              <button key={cfg.workerId}
                onClick={() => update(cfg.workerId, { remove: false })}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-600">
                + Restore {cfg.worker.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-end">
        <button onClick={handleApply} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? 'Applying…' : 'Apply & Continue'} <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}
