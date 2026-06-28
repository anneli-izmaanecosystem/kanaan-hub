'use client'

import { useState, useEffect } from 'react'
import { Users, Edit2, Check, X, Plus, ChevronDown, ChevronUp } from 'lucide-react'

type Entity = { id: number; name: string; entityType: string }
type Worker = {
  id: number; name: string; workerType: string; payStructure: string
  entityId: number; idNumber: string | null; bankAccount: string | null; bankName: string | null
  hourlyRate: string | null; stdHoursPerDay: string | null
  dailyRate: string | null; floorSalary: string | null; saturdayRate: string | null
  department: string | null; position: string | null; startDate: string | null
  active: boolean; notes: string | null
}

const ENTITY_TAG: Record<string, string> = {
  kanaan:             'bg-blue-100 text-blue-800',
  plant_hire:         'bg-amber-100 text-amber-800',
  investment_project: 'bg-purple-100 text-purple-800',
}

const inp = 'w-full rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'
const sel = `${inp} bg-white`

export default function StaffPage() {
  const [workers,  setWorkers]  = useState<Worker[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState<number | null>(null)   // workerId being edited
  const [form,     setForm]     = useState<Partial<Worker>>({})
  const [saving,   setSaving]   = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['kanaan']))
  const [showAdd,  setShowAdd]  = useState(false)
  const [addForm,  setAddForm]  = useState<Partial<Worker>>({ workerType: 'employee', payStructure: 'hourly', active: true })
  const [adding,   setAdding]   = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/workers').then(r => r.json()),
      fetch('/api/entities').then(r => r.json()),
    ]).then(([ws, ents]) => {
      setWorkers(ws.map((row: any) => row.worker ?? row))
      setEntities(ents)
      setLoading(false)
    })
  }, [])

  function startEdit(w: Worker) {
    setEditing(w.id)
    setForm({ ...w })
  }

  function cancelEdit() { setEditing(null); setForm({}) }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    const res = await fetch(`/api/workers/${editing}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const updated = await res.json()
      setWorkers(prev => prev.map(w => w.id === editing ? updated : w))
      setEditing(null); setForm({})
    }
    setSaving(false)
  }

  async function saveAdd() {
    if (!addForm.name || !addForm.entityId || !addForm.workerType || !addForm.payStructure) return
    setAdding(true)
    const res = await fetch('/api/workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      const created = await res.json()
      setWorkers(prev => [...prev, created])
      setShowAdd(false)
      setAddForm({ workerType: 'employee', payStructure: 'hourly', active: true })
    }
    setAdding(false)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  // Group by entity
  const grouped = entities.map(ent => ({
    entity: ent,
    workers: workers.filter(w => w.entityId === ent.id),
  })).filter(g => g.workers.length > 0)

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users size={20} className="text-gray-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Staff</h1>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          <Plus size={14} /> Add worker
        </button>
      </div>

      {/* Add worker form */}
      {showAdd && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-800 mb-4">New worker</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Name</label>
              <input className={inp} value={addForm.name ?? ''} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Entity</label>
              <select className={sel} value={addForm.entityId ?? ''} onChange={e => setAddForm(f => ({ ...f, entityId: parseInt(e.target.value) }))}>
                <option value="">— select —</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Type</label>
              <select className={sel} value={addForm.workerType ?? 'employee'} onChange={e => setAddForm(f => ({ ...f, workerType: e.target.value }))}>
                <option value="employee">Employee (UIF applies)</option>
                <option value="contractor">Contractor (no UIF)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Pay structure</label>
              <select className={sel} value={addForm.payStructure ?? 'hourly'} onChange={e => setAddForm(f => ({ ...f, payStructure: e.target.value }))}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="floor">Floor salary</option>
              </select>
            </div>
            <PayRateFields form={addForm} setForm={setAddForm} />
          </div>
          <div className="flex gap-2">
            <button onClick={saveAdd} disabled={adding || !addForm.name || !addForm.entityId}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50">
              {adding ? 'Adding…' : 'Add worker'}
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Grouped by entity */}
      <div className="space-y-6">
        {grouped.map(({ entity, workers: ews }) => {
          const isOpen = expanded.has(entity.entityType)
          return (
            <div key={entity.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <button
                onClick={() => setExpanded(prev => {
                  const n = new Set(prev); isOpen ? n.delete(entity.entityType) : n.add(entity.entityType); return n
                })}
                className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ENTITY_TAG[entity.entityType] ?? 'bg-gray-100 text-gray-700'}`}>
                    {entity.name}
                  </span>
                  <span className="text-xs text-gray-400">{ews.length} workers</span>
                </div>
                {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
              </button>

              {isOpen && (
                <div className="divide-y divide-gray-50">
                  {/* Header row */}
                  <div className="grid grid-cols-12 gap-2 px-5 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
                    <div className="col-span-3">Name</div>
                    <div className="col-span-2">Type / UIF</div>
                    <div className="col-span-2">Pay structure</div>
                    <div className="col-span-2">Rate</div>
                    <div className="col-span-2">Position</div>
                    <div className="col-span-1"></div>
                  </div>

                  {ews.map(w => (
                    <WorkerRow
                      key={w.id}
                      worker={w}
                      isEditing={editing === w.id}
                      form={form}
                      setForm={setForm}
                      saving={saving}
                      onEdit={() => startEdit(w)}
                      onSave={saveEdit}
                      onCancel={cancelEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WorkerRow({ worker, isEditing, form, setForm, saving, onEdit, onSave, onCancel }: {
  worker: Worker
  isEditing: boolean
  form: Partial<Worker>
  setForm: (fn: (f: Partial<Worker>) => Partial<Worker>) => void
  saving: boolean
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const inp2 = 'w-full rounded border border-indigo-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400'
  const sel2 = `${inp2} bg-white`

  if (!isEditing) {
    const rate = worker.payStructure === 'hourly'
      ? `R${worker.hourlyRate}/hr · ${worker.stdHoursPerDay}h`
      : worker.payStructure === 'daily'
      ? `R${worker.dailyRate}/day`
      : `R${worker.floorSalary} floor`

    return (
      <div className="grid grid-cols-12 gap-2 px-5 py-3 items-center hover:bg-gray-50 text-sm">
        <div className="col-span-3 font-medium text-gray-900 truncate">{worker.name}</div>
        <div className="col-span-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            worker.workerType === 'employee' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
          }`}>
            {worker.workerType === 'employee' ? '✓ Employee · UIF' : 'Contractor'}
          </span>
        </div>
        <div className="col-span-2 text-xs text-gray-500 capitalize">{worker.payStructure}</div>
        <div className="col-span-2 text-xs text-gray-700">{rate}</div>
        <div className="col-span-2 text-xs text-gray-500 truncate">{worker.position ?? worker.department ?? '—'}</div>
        <div className="col-span-1 flex justify-end">
          <button onClick={onEdit} className="rounded p-1 text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <Edit2 size={13} />
          </button>
        </div>
      </div>
    )
  }

  // Edit mode — full expanded row
  return (
    <div className="px-5 py-4 bg-indigo-50 border-l-4 border-indigo-400">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Name</label>
          <input className={inp2} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Worker type (UIF)</label>
          <select className={sel2} value={form.workerType ?? ''} onChange={e => setForm(f => ({ ...f, workerType: e.target.value }))}>
            <option value="employee">Employee — UIF applies</option>
            <option value="contractor">Contractor — no UIF</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Pay structure</label>
          <select className={sel2} value={form.payStructure ?? ''} onChange={e => setForm(f => ({ ...f, payStructure: e.target.value }))}>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="floor">Floor salary</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Position</label>
          <input className={inp2} value={form.position ?? ''} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
        </div>
        <PayRateFields form={form} setForm={setForm} small />
        <div>
          <label className="text-xs text-gray-500 mb-1 block">ID number</label>
          <input className={inp2} value={form.idNumber ?? ''} onChange={e => setForm(f => ({ ...f, idNumber: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Bank name</label>
          <input className={inp2} value={form.bankName ?? ''} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Bank account</label>
          <input className={inp2} value={form.bankAccount ?? ''} onChange={e => setForm(f => ({ ...f, bankAccount: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Start date</label>
          <input type="date" className={inp2} value={form.startDate ?? ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-gray-500 mb-1 block">Notes</label>
          <input className={inp2} value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-700 px-4 py-1.5 text-sm text-white hover:bg-indigo-800 disabled:opacity-50">
          <Check size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  )
}

function PayRateFields({ form, setForm, small }: {
  form: Partial<Worker>
  setForm: (fn: (f: Partial<Worker>) => Partial<Worker>) => void
  small?: boolean
}) {
  const inp2 = small
    ? 'w-full rounded border border-indigo-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400'
    : 'w-full rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'

  const ps = form.payStructure
  if (ps === 'hourly') return (
    <>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Hourly rate (R)</label>
        <input type="number" step="0.01" className={inp2} value={form.hourlyRate ?? ''} onChange={e => setForm(f => ({ ...f, hourlyRate: e.target.value }))} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Std hours / day</label>
        <input type="number" step="0.5" className={inp2} value={form.stdHoursPerDay ?? ''} onChange={e => setForm(f => ({ ...f, stdHoursPerDay: e.target.value }))} />
      </div>
    </>
  )
  if (ps === 'daily') return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">Daily rate (R)</label>
      <input type="number" step="0.01" className={inp2} value={form.dailyRate ?? ''} onChange={e => setForm(f => ({ ...f, dailyRate: e.target.value }))} />
    </div>
  )
  if (ps === 'floor') return (
    <>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Floor salary (R/month)</label>
        <input type="number" step="0.01" className={inp2} value={form.floorSalary ?? ''} onChange={e => setForm(f => ({ ...f, floorSalary: e.target.value }))} />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Saturday on-site rate (R)</label>
        <input type="number" step="0.01" className={inp2} value={form.saturdayRate ?? ''} onChange={e => setForm(f => ({ ...f, saturdayRate: e.target.value }))} />
      </div>
    </>
  )
  return null
}
