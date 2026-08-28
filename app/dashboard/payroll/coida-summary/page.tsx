'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { Printer, Download } from 'lucide-react'

type Employee = {
  id: number; name: string; idNumber: string | null
  grossPay: string; deductions: string; netPay: string; uifEmployee: string
}
type Totals = { grossPay: string; deductions: string; netPay: string; uifEmployee: string }
type Entity = { id: number; name: string; tradingName: string | null; entityType: string; coidRef: string | null; address: string | null }

function r(n: string | number | null | undefined) {
  return `R ${parseFloat(String(n ?? '0')).toFixed(2)}`
}

// Default range: from the start of the current COID year (1 March) back to today,
// or the prior 12 months if we're before March — adjust freely per period picked.
function defaultRange() {
  const today = new Date()
  const year  = today.getUTCMonth() >= 2 ? today.getUTCFullYear() : today.getUTCFullYear() - 1
  return { start: `${year}-03-01`, end: today.toISOString().slice(0, 10) }
}

export default function CoidaSummaryPage() {
  const [range, setRange] = useState(defaultRange())
  const [data, setData]   = useState<{ employees: Employee[]; totals: Totals; runsIncluded: number } | null>(null)
  const [entity, setEntity] = useState<Entity | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [summary, entities] = await Promise.all([
      fetch(`/api/payroll/coida-summary?start=${range.start}&end=${range.end}`).then(res => res.json()),
      fetch('/api/entities').then(res => res.json()),
    ])
    setData(summary)
    setEntity(entities.find((e: Entity) => e.entityType === 'kanaan') ?? null)
    setLoading(false)
  }, [range])

  useEffect(() => { load() }, [load])

  function downloadCsv() {
    if (!data) return
    const header = ['Employee', 'ID Number', 'Gross Pay', 'Deductions', 'Net Pay', 'UIF – Employee']
    const rows = data.employees.map(e => [e.name, e.idNumber ?? '', e.grossPay, e.deductions, e.netPay, e.uifEmployee])
    const totalRow = ['TOTAL', '', data.totals.grossPay, data.totals.deductions, data.totals.netPay, data.totals.uifEmployee]
    const meta = [
      [`Employer: ${entity?.tradingName ?? entity?.name ?? ''}`],
      [`COID Reference: ${entity?.coidRef ?? 'N/A'}`],
      [`Period: ${fmtDate(range.start)} – ${fmtDate(range.end)}`],
      [],
    ]
    const csv = [...meta, header, ...rows, [], totalRow]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `COIDA-Summary-${range.start}-to-${range.end}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* Nav + controls — hidden on print */}
      <div className="print:hidden flex items-center justify-between mb-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/dashboard/payroll" className="hover:text-gray-700">Payroll</Link>
          <span>/</span>
          <span className="text-gray-700">COIDA Summary</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
          <span className="text-gray-400 text-sm">–</span>
          <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
          <button onClick={downloadCsv}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-xl print:shadow-none print:rounded-none print:max-w-full">
        <div className="px-8 py-6 border-b border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">COIDA Return of Earnings — Summary</p>
          <h1 className="text-xl font-bold text-gray-900">{entity?.tradingName ?? entity?.name ?? 'Kanaan Guest Farm'}</h1>
          {entity?.address && <p className="text-xs text-gray-500 mt-1">{entity.address}</p>}
          <div className="mt-3 flex gap-8 text-sm">
            <div>
              <p className="text-xs text-gray-400">COID Reference</p>
              <p className="font-semibold text-gray-800">{entity?.coidRef ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Period</p>
              <p className="font-semibold text-gray-800">{fmtDate(range.start)} – {fmtDate(range.end)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Employees</p>
              <p className="font-semibold text-gray-800">{data?.employees.length ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 overflow-x-auto">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !data || data.employees.length === 0 ? (
            <p className="text-sm text-gray-400">No finalised payroll runs in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">#</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Employee</th>
                  <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">ID Number</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Gross Pay</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Deductions</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Net Pay</th>
                  <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">UIF – Ee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.employees.map((e, i) => (
                  <tr key={e.id}>
                    <td className="py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="py-2.5 font-medium text-gray-900">{e.name}</td>
                    <td className="py-2.5 text-gray-500 font-mono text-xs">{e.idNumber ?? '—'}</td>
                    <td className="py-2.5 text-right text-gray-700">{r(e.grossPay)}</td>
                    <td className="py-2.5 text-right text-gray-700">{r(e.deductions)}</td>
                    <td className="py-2.5 text-right text-gray-700">{r(e.netPay)}</td>
                    <td className="py-2.5 text-right text-gray-700">{r(e.uifEmployee)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-900">
                  <td className="pt-3 text-xs font-bold text-gray-500 uppercase" colSpan={3}>Total</td>
                  <td className="pt-3 text-right font-bold text-gray-900">{r(data.totals.grossPay)}</td>
                  <td className="pt-3 text-right font-bold text-gray-900">{r(data.totals.deductions)}</td>
                  <td className="pt-3 text-right font-bold text-gray-900">{r(data.totals.netPay)}</td>
                  <td className="pt-3 text-right font-bold text-gray-900">{r(data.totals.uifEmployee)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-8 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 leading-5">
          Sums every finalised payroll run (all entities, employees only — contractors excluded) whose pay period falls within the dates above, computed live from payroll records. Cross-check against actual filed COIDA/UIF submissions before relying on this for a return.
        </div>
      </div>

      <style>{`@media print { body { background: white !important; } .print\\:hidden { display: none !important; } }`}</style>
    </div>
  )
}
