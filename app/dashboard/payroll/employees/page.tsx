'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Pencil } from 'lucide-react'

type Entity = { id: number; name: string; entityType: string }
type Worker = {
  worker: {
    id: number; name: string; idNumber: string | null; department: string | null
    position: string | null; workerType: string; payStructure: string
    hourlyRate: string | null; stdHoursPerDay: string | null
    dailyRate: string | null; floorSalary: string | null; saturdayRate: string | null
    bankName: string | null; bankAccount: string | null; active: boolean
    startDate: string | null; notes: string | null
  }
  entity: Entity
}

const ENTITY_COLOURS: Record<string, string> = {
  kanaan:             'bg-blue-100 text-blue-800',
  plant_hire:         'bg-amber-100 text-amber-800',
  investment_project: 'bg-purple-100 text-purple-800',
}

const blank = {
  entityId: '', name: '', workerType: 'employee', payStructure: 'hourly',
  idNumber: '', bankAccount: '', bankName: '',
  hourlyRate: '', stdHoursPerDay: '6.5',
  dailyRate: '', floorSalary: '', saturdayRate: '',
  department: '', position: '', startDate: '', notes: '',
}

export default function WorkersPage() {
  const [workers,      setWorkers]      = useState<Worker[]>([])
  const [entities,     setEntities]     = useState<Entity[]>([])
  const [filterEntity, setFilterEntity] = useState('all')
  const [showForm,     setShowForm]     = useState(false)
  const [editId,       setEditId]       = useState<number | null>(null)
  const [form,         setForm]         = useState({ ...blank })
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  function reload() {
    fetch('/api/workers').then(r => r.json()).then(setWorkers)
  }

  useEffect(() => {
    fetch('/api/entities').then(r => r.json()).then(setEntities)
    reload()
  }, [])

  function s(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function openAdd() {
    setEditId(null)
    setForm({ ...blank, entityId: entities[0]?.id ? String(entities[0].id) : '' })
    setError(''); setShowForm(true)
  }

  function openEdit(w: Worker['worker'], entity: Entity) {
    setEditId(w.id)
    setForm({
      entityId: String(entity.id), name: w.name,
      workerType: w.workerType, payStructure: w.payStructure,
      idNumber: w.idNumber ?? '', bankAccount: w.bankAccount ?? '', bankName: w.bankName ?? '',
      hourlyRate: w.hourlyRate ?? '', stdHoursPerDay: w.stdHoursPerDay ?? '6.5',
      dailyRate: w.dailyRate ?? '', floorSalary: w.floorSalary ?? '', saturdayRate: w.saturdayRate ?? '',
      department: w.department ?? '', position: w.position ?? '',
      startDate: w.startDate ?? '', notes: w.notes ?? '',
    })
    setError(''); setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    const url    = editId ? `/api/workers/${editId}` : '/api/workers'
    const method = editId ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error); setSaving(false); return }
    reload(); setShowForm(false); setForm({ ...blank }); setSaving(false)
  }

  async function toggleActive(w: Worker['worker']) {
    await fetch(`/api/workers/${w.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !w.active }),
    })
    reload()
  }

  const filtered = filterEntity === 'all' ? workers
    : workers.filter(w => String(w.entity.id) === filterEntity)

  function rateLabel(w: Worker['worker']) {
    if (w.payStructure === 'hourly') return `R${w.hourlyRate}/hr · ${w.stdHoursPerDay}h/day`
    if (w.payStructure === 'daily')  return `R${w.dailyRate}/day`
    if (w.payStructure === 'floor')  return `R${w.floorSalary} floor + R${w.saturdayRate}/Sat`
    return '—'
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Workers</h1>
        <button onClick={openAdd}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          <Plus size={15} /> Add Worker
        </button>
      </div>

      {/* Entity filter */}
      <div className="flex gap-2 mb-5">
        {[{ id: 'all', name: 'All' }, ...entities.map(e => ({ id: String(e.id), name: e.name }))].map(en => (
          <button key={en.id} onClick={() => setFilterEntity(en.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterEntity === en.id ? 'bg-gray-900 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {en.name}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Entity</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Pay Structure</th>
              <th className="px-4 py-3 text-left">Rate</th>
              <th className="px-4 py-3 text-center">Active</th>
              <th className="px-4 py-3 text-center">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">No workers yet.</td></tr>
            )}
            {filtered.map(({ worker: w, entity }) => (
              <tr key={w.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{w.name}</p>
                  {w.position && <p className="text-xs text-gray-400">{w.position}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ENTITY_COLOURS[entity.entityType] ?? 'bg-gray-100 text-gray-600'}`}>
                    {entity.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs capitalize">{w.workerType}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize">{w.payStructure}</span>
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">{rateLabel(w)}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(w)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${w.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                    {w.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => openEdit(w, entity)}
                    className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                    <Pencil size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">{editId ? 'Edit Worker' : 'Add Worker'}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={lbl}>Entity *</label>
                <select className={inp} value={form.entityId} onChange={e => s('entityId', e.target.value)} required>
                  <option value="">Select entity…</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </select>
              </div>

              <div>
                <label className={lbl}>Name *</label>
                <input className={inp} value={form.name} onChange={e => s('name', e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Worker Type *</label>
                  <select className={inp} value={form.workerType} onChange={e => s('workerType', e.target.value)}>
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Pay Structure *</label>
                  <select className={inp} value={form.payStructure} onChange={e => s('payStructure', e.target.value)}>
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily rate</option>
                    <option value="floor">Floor salary</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pay Rates</p>
                {form.payStructure === 'hourly' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Hourly Rate (R) *</label>
                      <input type="number" step="0.01" className={inp} value={form.hourlyRate}
                        onChange={e => s('hourlyRate', e.target.value)} required />
                    </div>
                    <div>
                      <label className={lbl}>Std Hours / Day</label>
                      <input type="number" step="0.5" className={inp} value={form.stdHoursPerDay}
                        onChange={e => s('stdHoursPerDay', e.target.value)} />
                    </div>
                  </div>
                )}
                {form.payStructure === 'daily' && (
                  <div>
                    <label className={lbl}>Daily Rate (R) *</label>
                    <input type="number" step="0.01" className={inp} value={form.dailyRate}
                      onChange={e => s('dailyRate', e.target.value)} required />
                  </div>
                )}
                {form.payStructure === 'floor' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Floor Salary (R/month)</label>
                      <input type="number" step="0.01" className={inp} value={form.floorSalary}
                        onChange={e => s('floorSalary', e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Saturday On-site Rate (R)</label>
                      <input type="number" step="0.01" className={inp} value={form.saturdayRate}
                        onChange={e => s('saturdayRate', e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Department</label>
                  <input className={inp} value={form.department} onChange={e => s('department', e.target.value)} />
                </div>
                <div>
                  <label className={lbl}>Position</label>
                  <input className={inp} value={form.position} onChange={e => s('position', e.target.value)} />
                </div>
              </div>

              {form.workerType === 'employee' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>SA ID Number</label>
                      <input className={inp} value={form.idNumber} onChange={e => s('idNumber', e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Start Date</label>
                      <input type="date" className={inp} value={form.startDate} onChange={e => s('startDate', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Bank Name</label>
                      <input className={inp} value={form.bankName} onChange={e => s('bankName', e.target.value)} />
                    </div>
                    <div>
                      <label className={lbl}>Account Number</label>
                      <input className={inp} value={form.bankAccount} onChange={e => s('bankAccount', e.target.value)} />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className={lbl}>Notes</label>
                <input className={inp} value={form.notes} onChange={e => s('notes', e.target.value)} />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
                  {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Worker'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
