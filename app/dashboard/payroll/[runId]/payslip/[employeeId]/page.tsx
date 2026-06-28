'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { Printer } from 'lucide-react'

type Entity = {
  name: string; tradingName: string | null; registrationNo: string | null
  uifRef: string | null; payeRef: string | null; address: string | null
}
type Worker = {
  name: string; idNumber: string | null; bankName: string | null
  bankAccount: string | null; workerType: string; payStructure: string
  position: string | null; department: string | null
}
type Entry = {
  ordinaryHours: string; saturdayHours: string; phHours: string
  daysWorked: string; saturdayDays: string
  basicPay: string; saturdayPay: string; phPay: string
  bonus: string; otherAdditions: string
  salaryAdvance: string; shopDeductions: string
  uifEmployee: string; uifEmployer: string; otherDeductions: string
  grossPay: string; netPay: string
  annualLeaveDaysTaken: string; sickLeaveDaysTaken: string
  contractorInvoiceNo: string | null; engagementDescription: string | null
  notes: string | null
}
type Run = { periodStart: string; periodEnd: string }

function r(n: string | number | null | undefined) {
  return `R ${parseFloat(String(n ?? '0')).toFixed(2)}`
}

function Row({ label, value, red }: { label: string; value: string | number; red?: boolean }) {
  return (
    <tr>
      <td className="py-1.5 pr-4 text-gray-600">{label}</td>
      <td className={`py-1.5 text-right font-medium ${red ? 'text-red-600' : 'text-gray-900'}`}>
        {red ? `(${r(value)})` : r(value)}
      </td>
    </tr>
  )
}

export default function PayslipPage() {
  const { runId, employeeId } = useParams<{ runId: string; employeeId: string }>()
  const [data,    setData]    = useState<{ run: Run; entity: Entity; worker: Worker; entry: Entry } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/payroll/${runId}/payslip/${employeeId}`)
      .then(res => res.json())
      .then(d => { setData(d); setLoading(false) })
  }, [runId, employeeId])

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>
  if (!data)   return <div className="p-8 text-sm text-red-500">Not found.</div>

  const { run, entity, worker, entry } = data
  const isContractor = worker.workerType === 'contractor'

  const hasDeductions = [entry.salaryAdvance, entry.shopDeductions, entry.uifEmployee, entry.otherDeductions]
    .some(v => parseFloat(v) > 0)

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      {/* Nav — hidden on print */}
      <div className="print:hidden flex items-center justify-between mb-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/dashboard/payroll" className="hover:text-gray-700">Payroll</Link>
          <span>/</span>
          <Link href={`/dashboard/payroll/${runId}`} className="hover:text-gray-700">Run #{runId}</Link>
          <span>/</span>
          <span className="text-gray-700">{isContractor ? 'Invoice' : 'Payslip'} — {worker.name}</span>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          <Printer size={14} /> Print / Save PDF
        </button>
      </div>

      {/* Document */}
      <div className="max-w-2xl mx-auto bg-white shadow-sm rounded-xl print:shadow-none print:rounded-none print:max-w-full">

        {/* Header */}
        <div className="border-b border-gray-200 px-8 py-6 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
              {isContractor ? 'Tax Invoice' : 'Payslip'}
            </p>
            <h1 className="text-xl font-bold text-gray-900">{entity.tradingName ?? entity.name}</h1>
            {entity.address && <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{entity.address}</p>}
            <div className="mt-2 space-y-0.5 text-xs text-gray-500">
              {entity.registrationNo && <p>Reg: {entity.registrationNo}</p>}
              {!isContractor && entity.uifRef && <p>UIF Ref: {entity.uifRef}</p>}
              {entity.payeRef && <p>PAYE Ref: {entity.payeRef}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-1">Pay period</p>
            <p className="text-sm font-semibold text-gray-800">
              {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
            </p>
            {isContractor && entry.contractorInvoiceNo && (
              <p className="text-xs text-gray-500 mt-1">Invoice #{entry.contractorInvoiceNo}</p>
            )}
          </div>
        </div>

        {/* Worker / contractor details */}
        <div className="px-8 py-5 border-b border-gray-100 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-1">{isContractor ? 'Contractor' : 'Employee'}</p>
            <p className="font-semibold text-gray-900">{worker.name}</p>
            {worker.position   && <p className="text-xs text-gray-500">{worker.position}</p>}
            {worker.department && <p className="text-xs text-gray-500">{worker.department}</p>}
            {!isContractor && worker.idNumber && (
              <p className="text-xs text-gray-400 mt-1">ID: {worker.idNumber}</p>
            )}
          </div>
          {!isContractor && (worker.bankName || worker.bankAccount) ? (
            <div className="text-right">
              <p className="text-xs text-gray-400 mb-1">Payment</p>
              {worker.bankName    && <p className="text-xs text-gray-600">{worker.bankName}</p>}
              {worker.bankAccount && <p className="text-xs text-gray-600">Acc: {worker.bankAccount}</p>}
            </div>
          ) : isContractor && entry.engagementDescription ? (
            <div>
              <p className="text-xs text-gray-400 mb-1">Services rendered</p>
              <p className="text-xs text-gray-700">{entry.engagementDescription}</p>
            </div>
          ) : null}
        </div>

        {/* Earnings */}
        <div className="px-8 py-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Earnings</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {parseFloat(entry.basicPay) > 0 && (
                <Row label={
                  worker.payStructure === 'hourly' ? `Basic pay (${entry.ordinaryHours} hrs)`
                  : worker.payStructure === 'daily' ? `Basic pay (${entry.daysWorked} days)`
                  : 'Floor salary'
                } value={entry.basicPay} />
              )}
              {parseFloat(entry.saturdayPay) > 0 && (
                <Row label={
                  worker.payStructure === 'hourly'
                    ? `Saturday pay (${entry.saturdayHours} hrs × 1.5)`
                    : `Saturday on-site (${entry.saturdayDays} day(s))`
                } value={entry.saturdayPay} />
              )}
              {parseFloat(entry.phPay)          > 0 && <Row label="Public holiday pay (× 2.0)"  value={entry.phPay} />}
              {parseFloat(entry.bonus)           > 0 && <Row label="Bonus"                       value={entry.bonus} />}
              {parseFloat(entry.otherAdditions)  > 0 && <Row label="Other additions"             value={entry.otherAdditions} />}
            </tbody>
          </table>
          <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between font-semibold text-sm">
            <span className="text-gray-700">Gross pay</span>
            <span className="text-gray-900">{r(entry.grossPay)}</span>
          </div>
        </div>

        {/* Deductions */}
        {hasDeductions && (
          <div className="px-8 py-5 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Deductions</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {parseFloat(entry.salaryAdvance)  > 0 && <Row label="Salary advance"    value={entry.salaryAdvance}  red />}
                {parseFloat(entry.shopDeductions) > 0 && <Row label="Shop deductions"   value={entry.shopDeductions} red />}
                {parseFloat(entry.uifEmployee)    > 0 && <Row label="UIF (employee 1%)" value={entry.uifEmployee}    red />}
                {parseFloat(entry.otherDeductions)> 0 && <Row label="Other deductions"  value={entry.otherDeductions}red />}
              </tbody>
            </table>
          </div>
        )}

        {/* Net pay */}
        <div className="px-8 py-6 border-t-2 border-gray-900 flex justify-between items-baseline">
          <span className="text-base font-bold text-gray-900">{isContractor ? 'Total due' : 'Net pay'}</span>
          <span className="text-3xl font-bold text-gray-900">{r(entry.netPay)}</span>
        </div>

        {/* Employer UIF info line */}
        {!isContractor && parseFloat(entry.uifEmployer) > 0 && (
          <div className="px-8 py-3 bg-gray-50 border-t border-gray-100 flex justify-between text-xs text-gray-500">
            <span>Employer UIF (1%) — payable to SARS, not deducted from employee</span>
            <span className="font-medium">{r(entry.uifEmployer)}</span>
          </div>
        )}

        {/* Leave */}
        {!isContractor && (parseFloat(entry.annualLeaveDaysTaken) > 0 || parseFloat(entry.sickLeaveDaysTaken) > 0) && (
          <div className="px-8 py-4 border-t border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Leave this period</p>
            <div className="flex gap-6 text-sm text-gray-600">
              {parseFloat(entry.annualLeaveDaysTaken) > 0 && <span>Annual leave: {entry.annualLeaveDaysTaken} day(s)</span>}
              {parseFloat(entry.sickLeaveDaysTaken)   > 0 && <span>Sick leave: {entry.sickLeaveDaysTaken} day(s)</span>}
            </div>
          </div>
        )}

        {entry.notes && (
          <div className="px-8 py-3 border-t border-gray-100 text-xs text-gray-400">{entry.notes}</div>
        )}

        {/* Legal footer */}
        <div className="px-8 py-5 border-t border-gray-100 text-center text-xs text-gray-400 leading-5">
          {isContractor
            ? 'This invoice is rendered by an independent contractor. No employment relationship is created or implied.'
            : 'Issued in accordance with the Basic Conditions of Employment Act 75 of 1997 and the Unemployment Insurance Act.'}
        </div>
      </div>

      <style>{`@media print { body { background: white !important; } .print\\:hidden { display: none !important; } }`}</style>
    </div>
  )
}
