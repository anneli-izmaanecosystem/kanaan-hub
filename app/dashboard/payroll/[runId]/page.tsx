'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmt, fmtDate } from '@/lib/utils'
import { Download, Lock } from 'lucide-react'

type Entry = {
  entry: {
    id: number; employeeId: number; ordinaryHours: string; overtimeHours: string
    sundayPhHours: string; bonus: string; otherAdditions: string; leaveDeduction: string
    otherDeductions: string; leaveDaysTaken: string; basicPay: string; overtimePay: string
    grossPay: string; uifEmployee: string; netPay: string; notes: string | null
  }
  employee: { id: number; name: string; payType: string; hoursType: string; department: string | null }
}

type Run = { id: number; periodStart: string; periodEnd: string; status: string }

export default function PayrollRunPage() {
  const { runId } = useParams<{ runId: string }>()
  const router    = useRouter()
  const [run, setRun]         = useState<Run | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [finalising, setFinalising] = useState(false)

  useEffect(() => {
    fetch(`/api/payroll/${runId}`)
      .then(r => r.json())
      .then(d => { setRun(d.run); setEntries(d.entries ?? []); setLoading(false) })
  }, [runId])

  async function updateEntry(entryId: number, patch: Record<string, string>) {
    const res = await fetch(`/api/payroll/${runId}/entries/${entryId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    if (res.ok) {
      const updated = await res.json()
      setEntries(prev => prev.map(e => e.entry.id === entryId ? { ...e, entry: updated } : e))
    }
  }

  async function finalise() {
    if (!confirm('Finalise this payroll run? This cannot be undone.')) return
    setFinalising(true)
    const res = await fetch(`/api/payroll/${runId}/finalise`, { method: 'POST' })
    if (res.ok) setRun(await res.json())
    setFinalising(false)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!run)    return <div className="p-8 text-sm text-red-500">Run not found.</div>

  const totalNet = entries.reduce((s, e) => s + parseFloat(e.entry.netPay), 0)
  const isLocked = run.status === 'finalised'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Payroll Run #{run.id}</h1>
          <p className="text-sm text-gray-500">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isLocked ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
            {run.status}
          </span>
          {!isLocked && (
            <button onClick={finalise} disabled={finalising} className="flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
              <Lock size={14} /> {finalising ? 'Finalising…' : 'Finalise Run'}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-3 text-left">Employee</th>
              <th className="px-3 py-3 text-center">Ord. Hrs</th>
              <th className="px-3 py-3 text-center">OT Hrs</th>
              <th className="px-3 py-3 text-center">Sun/PH Hrs</th>
              <th className="px-3 py-3 text-right">Basic</th>
              <th className="px-3 py-3 text-right">OT Pay</th>
              <th className="px-3 py-3 text-center">Bonus</th>
              <th className="px-3 py-3 text-right">Gross</th>
              <th className="px-3 py-3 text-right">UIF Emp</th>
              <th className="px-3 py-3 text-right">Net Pay</th>
              <th className="px-3 py-3 text-center">Payslip</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map(({ entry, employee }) => (
              <PayrollRow
                key={entry.id}
                entry={entry}
                employee={employee}
                runId={runId}
                locked={isLocked}
                onUpdate={patch => updateEntry(entry.id, patch)}
              />
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold text-sm">
            <tr>
              <td colSpan={9} className="px-3 py-3 text-right text-gray-600">Total Net Pay</td>
              <td className="px-3 py-3 text-right text-gray-900">{fmt(totalNet)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function PayrollRow({ entry, employee, runId, locked, onUpdate }: {
  entry: any; employee: any; runId: string; locked: boolean
  onUpdate: (patch: Record<string, string>) => void
}) {
  const numInput = (field: string) => (
    <input
      type="number" step="0.01"
      disabled={locked}
      defaultValue={entry[field]}
      className="w-16 text-center rounded border border-gray-200 px-1 py-0.5 text-xs disabled:bg-transparent disabled:border-transparent"
      onBlur={e => { if (e.target.value !== entry[field]) onUpdate({ [field]: e.target.value }) }}
    />
  )

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <p className="font-medium text-gray-900">{employee.name}</p>
        <p className="text-gray-400">{employee.department ?? employee.payType}</p>
      </td>
      <td className="px-3 py-2 text-center">{numInput('ordinaryHours')}</td>
      <td className="px-3 py-2 text-center">{numInput('overtimeHours')}</td>
      <td className="px-3 py-2 text-center">{numInput('sundayPhHours')}</td>
      <td className="px-3 py-2 text-right">{fmt(entry.basicPay)}</td>
      <td className="px-3 py-2 text-right">{fmt(entry.overtimePay)}</td>
      <td className="px-3 py-2 text-center">{numInput('bonus')}</td>
      <td className="px-3 py-2 text-right font-medium">{fmt(entry.grossPay)}</td>
      <td className="px-3 py-2 text-right text-red-600">-{fmt(entry.uifEmployee)}</td>
      <td className="px-3 py-2 text-right font-semibold text-green-700">{fmt(entry.netPay)}</td>
      <td className="px-3 py-2 text-center">
        <Link href={`/dashboard/payroll/${runId}/payslip/${employee.id}`}
          className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200">
          <Download size={10} /> PDF
        </Link>
      </td>
    </tr>
  )
}
