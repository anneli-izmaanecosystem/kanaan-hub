'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmt, fmtDate } from '@/lib/utils'
import { Lock, Users, ChevronRight, AlertTriangle, MessageSquare, Settings2, Trash2, FileSpreadsheet } from 'lucide-react'

type Worker = {
  id: number; name: string; workerType: string; payStructure: string
  department: string | null; position: string | null
}
type Entry = {
  id: number; workerId: number; grossPay: string; netPay: string
  salaryAdvance: string; shopDeductions: string; uifEmployee: string
  uifEmployer: string; payeTaxableAmount: string | null; notes: string | null
}
type Run = { id: number; periodStart: string; periodEnd: string; status: string; entityId: number }
type Entity = { id: number; name: string; entityType: string }

const ENTITY_TAG: Record<string, string> = {
  kanaan:             'bg-blue-100 text-blue-800',
  plant_hire:         'bg-amber-100 text-amber-800',
  investment_project: 'bg-purple-100 text-purple-800',
}

export default function PayrollRunPage() {
  const { runId } = useParams<{ runId: string }>()
  const router    = useRouter()

  const [run,     setRun]     = useState<Run | null>(null)
  const [entity,  setEntity]  = useState<Entity | null>(null)
  const [entries, setEntries] = useState<{ entry: Entry; worker: Worker }[]>([])
  const [loading, setLoading] = useState(true)
  const [finalising, setFinalising] = useState(false)

  useEffect(() => {
    fetch(`/api/payroll/${runId}`)
      .then(r => r.json())
      .then(d => {
        setRun(d.run)
        setEntity(d.entity ?? null)
        setEntries(d.entries ?? [])
        setLoading(false)
      })
  }, [runId])

  async function deleteRun() {
    if (!confirm('Delete this draft payroll run? This cannot be undone.')) return
    const res = await fetch(`/api/payroll/${runId}`, { method: 'DELETE' })
    if (res.ok) router.push('/dashboard/payroll')
  }

  async function finalise() {
    if (!confirm('Finalise this payroll run? This cannot be undone.')) return
    setFinalising(true)
    const res = await fetch(`/api/payroll/${runId}/finalise`, { method: 'POST' })
    if (res.ok) setRun(prev => prev ? { ...prev, status: 'finalised' } : prev)
    setFinalising(false)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!run)    return <div className="p-8 text-sm text-red-500">Run not found.</div>

  const isLocked   = run.status === 'finalised'
  const totalGross = entries.reduce((s, e) => s + parseFloat(e.entry.grossPay  || '0'), 0)
  const totalNet   = entries.reduce((s, e) => s + parseFloat(e.entry.netPay    || '0'), 0)
  const totalUIF   = entries.reduce((s, e) => s + parseFloat(e.entry.uifEmployer || '0'), 0)

  // Split by worker type
  const employees   = entries.filter(e => e.worker.workerType === 'employee')
  const contractors = entries.filter(e => e.worker.workerType === 'contractor')

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dashboard/payroll" className="text-sm text-gray-400 hover:text-gray-600">Payroll</Link>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-600">Run #{run.id}</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
          </h1>
          {entity && (
            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ENTITY_TAG[entity.entityType] ?? 'bg-gray-100 text-gray-700'}`}>
              {entity.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isLocked ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
            {run.status}
          </span>
          {!isLocked && (
            <Link href={`/dashboard/payroll/${runId}/setup`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Settings2 size={14} /> Setup
            </Link>
          )}
          {!isLocked && (
            <button onClick={deleteRun}
              className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Delete
            </button>
          )}
          <Link href={`/dashboard/payroll/${runId}/staff-log`}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <MessageSquare size={14} /> Staff Log
          </Link>
          <Link href={`/dashboard/payroll/${runId}/uif-schedule`}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <FileSpreadsheet size={14} /> UIF Schedule
          </Link>
          {!isLocked && (
            <button onClick={finalise} disabled={finalising}
              className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
              <Lock size={14} /> {finalising ? 'Finalising…' : 'Finalise Run'}
            </button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Total Gross', value: fmt(totalGross) },
          { label: 'Total Net Pay', value: fmt(totalNet), highlight: true },
          { label: `Employer UIF (to SARS)`, value: fmt(totalUIF) },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 ${s.highlight ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-500 mb-1">{s.label}</p>
            <p className={`text-xl font-semibold ${s.highlight ? 'text-green-800' : 'text-gray-900'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Employees */}
      {employees.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-2">
            <Users size={13} /> Employees — UIF applicable
          </h2>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {employees.map(({ entry, worker }) => (
              <WorkerRow key={entry.id} entry={entry} worker={worker} runId={runId} locked={isLocked} />
            ))}
          </div>
        </section>
      )}

      {/* Contractors */}
      {contractors.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Contractors — No UIF
          </h2>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
            {contractors.map(({ entry, worker }) => (
              <WorkerRow key={entry.id} entry={entry} worker={worker} runId={runId} locked={isLocked} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function WorkerRow({ entry, worker, runId, locked }: {
  entry: Entry; worker: Worker; runId: string; locked: boolean
}) {
  const gross    = parseFloat(entry.grossPay    || '0')
  const net      = parseFloat(entry.netPay      || '0')
  const advances = parseFloat(entry.salaryAdvance  || '0')
  const shop     = parseFloat(entry.shopDeductions || '0')
  const payeFlag = entry.payeTaxableAmount != null && parseFloat(entry.payeTaxableAmount) * 12 > 95750

  return (
    <div className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-gray-900 truncate">{worker.name}</p>
          {payeFlag && (
            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
              <AlertTriangle size={10} /> PAYE watch
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          {worker.position ?? worker.department ?? worker.payStructure}
          {advances > 0 && <span className="ml-2 text-amber-600">· Advance {fmt(advances)}</span>}
          {shop > 0     && <span className="ml-2 text-amber-600">· Shop {fmt(shop)}</span>}
        </p>
      </div>

      <div className="flex items-center gap-8 mx-6 text-right">
        <div>
          <p className="text-xs text-gray-400">Gross</p>
          <p className="text-sm font-medium text-gray-700">{fmt(gross)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Net Pay</p>
          <p className="text-sm font-semibold text-green-700">{fmt(net)}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href={`/dashboard/payroll/${runId}/attendance/${worker.id}`}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300">
          Attendance
        </Link>
        <Link href={`/dashboard/payroll/${runId}/payslip/${worker.id}`}
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200">
          {worker.workerType === 'contractor' ? 'Invoice' : 'Payslip'}
        </Link>
        <ChevronRight size={14} className="text-gray-300" />
      </div>
    </div>
  )
}
