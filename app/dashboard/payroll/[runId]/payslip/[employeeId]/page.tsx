'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { fmt, fmtDate } from '@/lib/utils'
import { Download } from 'lucide-react'
import { downloadPayslipPdf } from '@/components/payslip-pdf'

export default function PayslipPage() {
  const { runId, employeeId } = useParams<{ runId: string; employeeId: string }>()
  const [data, setData]       = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    fetch(`/api/payroll/${runId}/payslip/${employeeId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [runId, employeeId])

  async function handleDownload() {
    setDownloading(true)
    try { await downloadPayslipPdf(data) } finally { setDownloading(false) }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!data?.entry) return <div className="p-8 text-sm text-red-500">Payslip not found.</div>

  const { run, employee, entry } = data

  const row = (label: string, value: string, accent?: string) => (
    <div key={label} className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium ${accent ?? 'text-gray-900'}`}>{value}</span>
    </div>
  )

  return (
    <div className="p-8 max-w-lg">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Payslip</h1>
          <p className="text-sm text-gray-500">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</p>
        </div>
        <button onClick={handleDownload} disabled={downloading}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          <Download size={14} /> {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-lg font-semibold text-gray-900">{employee.name}</p>
            {employee.department && <p className="text-sm text-gray-500">{employee.department}{employee.position ? ` · ${employee.position}` : ''}</p>}
          </div>
          {employee.idNumber && <p className="text-xs text-gray-400">ID: {employee.idNumber}</p>}
        </div>

        <div className="mb-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Earnings</p>
          {row(`Basic Pay (${entry.ordinaryHours} hrs)`, fmt(entry.basicPay))}
          {parseFloat(entry.overtimePay) > 0 && row(`Overtime (${entry.overtimeHours} hrs × 1.5)`, fmt(entry.overtimePay))}
          {parseFloat(entry.bonus) > 0        && row('Bonus', fmt(entry.bonus))}
          {row('Gross Pay', fmt(entry.grossPay), 'text-gray-900 font-bold')}
        </div>

        <div className="mb-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Deductions</p>
          {row('UIF (Employee 1%)', `-${fmt(entry.uifEmployee)}`, 'text-red-600')}
          {parseFloat(entry.otherDeductions) > 0 && row('Other Deductions', `-${fmt(entry.otherDeductions)}`, 'text-red-600')}
        </div>

        <div className="rounded-xl bg-gray-900 p-6 text-center">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-1">Net Pay</p>
          <p className="text-3xl font-bold text-white">{fmt(entry.netPay)}</p>
        </div>

        {(employee.bankName || employee.bankAccount) && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            <p>Pay to: <span className="font-medium text-gray-700">{employee.bankName}</span></p>
            <p>Account: <span className="font-medium text-gray-700">{employee.bankAccount}</span></p>
          </div>
        )}

        <p className="mt-4 text-xs text-gray-400 text-center">
          Employer UIF: {fmt(entry.uifEmployer)} — paid directly to UIF
        </p>
      </div>
    </div>
  )
}
