'use client'

import { useState, useEffect } from 'react'
import { fmt } from '@/lib/utils'
import { Plus, X, Pencil } from 'lucide-react'

type Employee = {
  id: number; name: string; idNumber: string | null; department: string | null
  position: string | null; payType: string; hoursType: string
  monthlySalary: string | null; hourlyRate: string | null; fixedHours: string | null
  overtimeHourlyRate: string | null; transportAllowance: string | null
  housingAllowance: string | null; otherAllowance: string | null
  bankName: string | null; bankAccount: string | null; active: boolean; startDate: string | null
}

const blank = {
  name: '', idNumber: '', bankAccount: '', bankName: '',
  payType: 'hourly', hoursType: 'variable',
  monthlySalary: '', hourlyRate: '', fixedHours: '', overtimeHourlyRate: '',
  transportAllowance: '', housingAllowance: '', otherAllowance: '',
  department: '', position: '', startDate: '',
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [editId, setEditId]       = useState<number | null>(null)
  const [form, setForm]           = useState({ ...blank })
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(setEmployees)
  }, [])

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function openAdd() {
    setEditId(null); setForm({ ...blank }); setError(''); setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setEditId(emp.id)
    setForm({
      name:               emp.name,
      idNumber:           emp.idNumber           ?? '',
      bankAccount:        emp.bankAccount        ?? '',
      bankName:           emp.bankName           ?? '',
      payType:            emp.payType,
      hoursType:          emp.hoursType,
      monthlySalary:      emp.monthlySalary      ?? '',
      hourlyRate:         emp.hourlyRate         ?? '',
      fixedHours:         emp.fixedHours         ?? '',
      overtimeHourlyRate: emp.overtimeHourlyRate ?? '',
      transportAllowance: emp.transportAllowance ?? '',
      housingAllowance:   emp.housingAllowance   ?? '',
      otherAllowance:     emp.otherAllowance     ?? '',
      department:         emp.department         ?? '',
      position:           emp.position           ?? '',
      startDate:          emp.startDate          ?? '',
    })
    setError(''); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    const url    = editId ? `/api/employees/${editId}` : '/api/employees'
    const method = editId ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error); setSaving(false); return }
    const emp = await res.json()
    setEmployees(prev => editId ? prev.map(e => e.id === editId ? emp : e) : [...prev, emp])
    setShowForm(false); setForm({ ...blank }); setSaving(false)
  }

  async function toggleActive(emp: Employee) {
    const res = await fetch(`/api/employees/${emp.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !emp.active }),
    })
    if (res.ok) {
      const updated = await res.json()
      setEmployees(prev => prev.map(e => e.id === emp.id ? updated : e))
    }
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Employees</h1>
        <button onClick={openAdd} className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          <Plus size={15} /> Add Employee
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-left">Pay Type</th>
              <th className="px-4 py-3 text-right">Basic Rate</th>
              <th className="px-4 py-3 text-right">OT Rate</th>
              <th className="px-4 py-3 text-right">Allowances</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3 text-center">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">No employees yet.</td></tr>
            )}
            {employees.map(emp => {
              const allowanceTotal =
                parseFloat(emp.transportAllowance ?? '0') +
                parseFloat(emp.housingAllowance   ?? '0') +
                parseFloat(emp.otherAllowance     ?? '0')
              const otRate = emp.overtimeHourlyRate
                ? `R${parseFloat(emp.overtimeHourlyRate).toFixed(2)}/hr`
                : emp.payType === 'hourly'
                  ? `R${(parseFloat(emp.hourlyRate ?? '0') * 1.5).toFixed(2)}/hr`
                  : 'From salary'
              return (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{emp.name}</p>
                    {emp.position && <p className="text-xs text-gray-400">{emp.position}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{emp.department ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      {emp.payType === 'fixed_salary' ? 'Fixed Salary' : 'Hourly'}
                      {' · '}{emp.hoursType === 'fixed_monthly' ? 'Fixed Hrs' : 'Variable'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 text-xs">
                    {emp.payType === 'fixed_salary'
                      ? `R${parseFloat(emp.monthlySalary ?? '0').toFixed(2)}/mo`
                      : `R${parseFloat(emp.hourlyRate ?? '0').toFixed(2)}/hr`}
                    {emp.fixedHours ? ` · ${emp.fixedHours}h` : ''}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{otRate}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">
                    {allowanceTotal > 0 ? `R${allowanceTotal.toFixed(2)}/mo` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(emp)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${emp.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {emp.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => openEdit(emp)} className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">{editId ? 'Edit Employee' : 'Add Employee'}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={lbl}>Full Name *</label>
                <input className={inp} value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>

              {/* Pay structure */}
              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pay Structure</p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Pay Type *</label>
                    <select className={inp} value={form.payType} onChange={e => set('payType', e.target.value)}>
                      <option value="hourly">Hourly Rate</option>
                      <option value="fixed_salary">Fixed Monthly Salary</option>
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Hours Type *</label>
                    <select className={inp} value={form.hoursType} onChange={e => set('hoursType', e.target.value)}>
                      <option value="variable">Variable (enter each run)</option>
                      <option value="fixed_monthly">Fixed Monthly Hours</option>
                    </select>
                  </div>
                </div>

                {form.payType === 'hourly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Hourly Rate (R) *</label>
                      <input type="number" step="0.01" className={inp} value={form.hourlyRate} onChange={e => set('hourlyRate', e.target.value)} required />
                    </div>
                    {form.hoursType === 'fixed_monthly' && (
                      <div>
                        <label className={lbl}>Fixed Hrs/Month</label>
                        <input type="number" step="0.5" className={inp} value={form.fixedHours} onChange={e => set('fixedHours', e.target.value)} />
                      </div>
                    )}
                  </div>
                )}

                {form.payType === 'fixed_salary' && (
                  <div>
                    <label className={lbl}>Monthly Salary (R) *</label>
                    <input type="number" step="0.01" className={inp} value={form.monthlySalary} onChange={e => set('monthlySalary', e.target.value)} required />
                  </div>
                )}

                <div>
                  <label className={lbl}>Overtime Hourly Rate (R) <span className="text-gray-400 font-normal normal-case">— leave blank to auto-derive</span></label>
                  <input type="number" step="0.01" className={inp} value={form.overtimeHourlyRate}
                    placeholder={form.payType === 'hourly' && form.hourlyRate ? `Auto: R${(parseFloat(form.hourlyRate||'0')).toFixed(2)}/hr (×1.5 = R${(parseFloat(form.hourlyRate||'0')*1.5).toFixed(2)})` : 'Auto: salary ÷ 173.33 hrs'}
                    onChange={e => set('overtimeHourlyRate', e.target.value)} />
                </div>
              </div>

              {/* Fixed allowances */}
              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Fixed Monthly Allowances</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={lbl}>Transport (R)</label>
                    <input type="number" step="0.01" className={inp} value={form.transportAllowance} onChange={e => set('transportAllowance', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Housing (R)</label>
                    <input type="number" step="0.01" className={inp} value={form.housingAllowance} onChange={e => set('housingAllowance', e.target.value)} />
                  </div>
                  <div>
                    <label className={lbl}>Other (R)</label>
                    <input type="number" step="0.01" className={inp} value={form.otherAllowance} onChange={e => set('otherAllowance', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Personal details */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Department</label>
                  <input className={inp} placeholder="Housekeeping, Kitchen…" value={form.department} onChange={e => set('department', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Position</label>
                  <input className={inp} value={form.position} onChange={e => set('position', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>SA ID Number</label>
                  <input className={inp} value={form.idNumber} onChange={e => set('idNumber', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Start Date</label>
                  <input type="date" className={inp} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Bank Name</label>
                  <input className={inp} placeholder="FNB, Standard Bank…" value={form.bankName} onChange={e => set('bankName', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Account Number</label>
                  <input className={inp} value={form.bankAccount} onChange={e => set('bankAccount', e.target.value)} />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
