'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { Printer, Download } from 'lucide-react'

type Employee = {
  id: number; name: string; idNumber: string | null
  grossPay: string; uifEmployee: string; uifEmployer: string
}
type Entity = {
  name: string; tradingName: string | null; uifRef: string | null; address: string | null
}
type Run = { periodStart: string; periodEnd: string }
type Totals = { grossPay: string; uifEmployee: string; uifEmployer: string }

function r(n: string | number | null | undefined) {
  return `R ${parseFloat(String(n ?? '0')).toFixed(2)}`
}

function total(a: string, b: string) {
  return r(parseFloat(a) + parseFloat(b))
}

export default function UifSchedulePage() {
  const { runId } = useParams<{ runId: string }>()
  const [data, setData]       = useState<{ run: Run; entity: Entity; employees: Employee[]; totals: Totals } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/payroll/${runId}/uif-schedule`)
      .then(res => res.json())
      .then(d => { setData(d); setLoading(false) })
  }, [runId])

  function downloadCsv() {
    if (!data) return
    const { entity, run, employees, totals } = data
    const header = ['Name', 'ID Number', 'Gross Remuneration', 'Employee UIF (1%)', 'Employer UIF (1%)', 'Total UIF']
    const rows = employees.map(e => [
      e.name,
      e.idNumber ?? '',
      parseFloat(e.grossPay).toFixed(2),
      parseFloat(e.uifEmployee).toFixed(2),
      parseFloat(e.uifEmployer).toFixed(2),
      (parseFloat(e.uifEmployee) + parseFloat(e.uifEmployer)).toFixed(2),
    ])
    const totalRow = [
      'TOTAL', '',
      parseFloat(totals.grossPay).toFixed(2),
      parseFloat(totals.uifEmployee).toFixed(2),
      parseFloat(totals.uifEmployer).toFixed(2),
      (parseFloat(totals.uifEmployee) + parseFloat(totals.uifEmployer)).toFixed(2),
    ]
    const meta = [
      [`Employer: ${entity.tradingName ?? entity.name}`],
      [`UIF Ref: ${entity.uifRef ?? 'N/A'}`],
      [`Period: ${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`],
      [],
    ]
    const csv = [...meta, header, ...rows, [], totalRow]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `UIF-Schedule-${run.periodStart}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!data)   return <div className="p-8 text-sm text-red-500">Not found.</div>

  const { run, entity, employees, totals } = data
  const grandTotal = (parseFloat(totals.uifEmployee) + parseFloat(totals.uifEmployer)).toFixed(2)

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* Nav — hidden on print */}
      <div className="print:hidden flex items-center justify-between mb-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/dashboard/payroll" className="hover:text-gray-700">Payroll</Link>
          <span>/</span>
          <Link href={`/dashboard/payroll/${runId}`} className="hover:text-gray-700">Run #{runId}</Link>
          <span>/</span>
          <span className="text-gray-700">UIF Schedule</span>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadCsv}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Download size={14} /> Download CSV
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {/* Document */}
      <div className="max-w-3xl mx-auto bg-white shadow-sm rounded-xl print:shadow-none print:rounded-none print:max-w-full">

        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-200">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">UIF Monthly Schedule — UI-19</p>
          <h1 className="text-xl font-bold text-gray-900">{entity.tradingName ?? entity.name}</h1>
          {entity.address && <p className="text-xs text-gray-500 mt-1">{entity.address}</p>}
          <div className="mt-3 flex gap-8 text-sm">
            <div>
              <p className="text-xs text-gray-400">UIF Reference</p>
              <p className="font-semibold text-gray-800">{entity.uifRef ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Pay Period</p>
              <p className="font-semibold text-gray-800">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Employees</p>
              <p className="font-semibold text-gray-800">{employees.length}</p>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="px-8 py-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">#</th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Employee</th>
                <th className="pb-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">ID Number</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Gross Remun.</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Ee UIF 1%</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Er UIF 1%</th>
                <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Total UIF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((e, i) => (
                <tr key={e.id}>
                  <td className="py-2.5 text-gray-400 text-xs">{i + 1}</td>
                  <td className="py-2.5 font-medium text-gray-900">{e.name}</td>
                  <td className="py-2.5 text-gray-500 font-mono text-xs">{e.idNumber ?? '—'}</td>
                  <td className="py-2.5 text-right text-gray-700">{r(e.grossPay)}</td>
                  <td className="py-2.5 text-right text-gray-700">{r(e.uifEmployee)}</td>
                  <td className="py-2.5 text-right text-gray-700">{r(e.uifEmployer)}</td>
                  <td className="py-2.5 text-right font-semibold text-gray-900">
                    {total(e.uifEmployee, e.uifEmployer)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-900">
                <td className="pt-3 text-xs font-bold text-gray-500 uppercase" colSpan={3}>Total</td>
                <td className="pt-3 text-right font-bold text-gray-900">{r(totals.grossPay)}</td>
                <td className="pt-3 text-right font-bold text-gray-900">{r(totals.uifEmployee)}</td>
                <td className="pt-3 text-right font-bold text-gray-900">{r(totals.uifEmployer)}</td>
                <td className="pt-3 text-right font-bold text-gray-900">{r(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* UIF ceiling note */}
        <div className="px-8 py-4 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 leading-5">
          UIF contributions are calculated at 1% employee + 1% employer on gross remuneration, capped at the statutory ceiling of R17,712/month (max contribution R177.12 per party). Total payable to SARS by employer: <span className="font-semibold text-gray-700">{r(grandTotal)}</span>.
        </div>
      </div>

      <style>{`@media print { body { background: white !important; } .print\\:hidden { display: none !important; } }`}</style>
    </div>
  )
}
