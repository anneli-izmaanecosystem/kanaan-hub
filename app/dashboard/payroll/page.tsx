export const dynamic = 'force-dynamic'

import { db, payrollRuns, payrollEntries } from '@/lib/db'
import { desc, eq, sum } from 'drizzle-orm'
import Link from 'next/link'
import { fmt, fmtDate } from '@/lib/utils'
import { Plus, Users } from 'lucide-react'

export default async function PayrollPage() {
  const runs = await db.select().from(payrollRuns).orderBy(desc(payrollRuns.periodStart))

  const runTotals = await Promise.all(
    runs.map(r =>
      db.select({ total: sum(payrollEntries.netPay) }).from(payrollEntries).where(eq(payrollEntries.runId, r.id))
    )
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Payroll</h1>
        <div className="flex gap-3">
          <Link href="/dashboard/payroll/employees" className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Users size={15} /> Employees
          </Link>
          <Link href="/dashboard/payroll/new" className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            <Plus size={15} /> New Run
          </Link>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-400 mb-3">No payroll runs yet.</p>
          <Link href="/dashboard/payroll/new" className="text-sm text-blue-600 hover:underline">Create your first run</Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Run #</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Total Net Pay</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run, i) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">#{run.id}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${run.status === 'finalised' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {fmt(runTotals[i]?.[0]?.total ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/dashboard/payroll/${run.id}`} className="text-xs text-blue-600 hover:underline">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
