'use client'

import { useState, useEffect } from 'react'
import { Plus, Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Driver = {
  id: number; name: string; phone: string; plate: string
  vehicle: string | null; active: boolean; onDuty: boolean
}

const inp = 'w-full rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'

/** WhatsApp caps a list message at 10 rows, so the picker cannot show more than this. */
const PICKER_LIMIT = 10

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<Driver>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<Partial<Driver>>({ active: true, onDuty: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/drivers').then(r => r.json()).then(d => {
      setDrivers(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function add() {
    if (!addForm.name || !addForm.phone || !addForm.plate) return
    setSaving(true); setError(null)
    const res = await fetch('/api/drivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      const created = await res.json()
      setDrivers(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAdd(false)
      setAddForm({ active: true, onDuty: true })
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not add that driver')
    }
    setSaving(false)
  }

  async function patch(id: number, body: Partial<Driver>) {
    setError(null)
    const res = await fetch(`/api/drivers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const updated = await res.json()
      setDrivers(prev => prev.map(d => (d.id === id ? updated : d)))
      return true
    }
    setError((await res.json().catch(() => ({}))).error ?? 'Could not save that change')
    return false
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    if (await patch(editing, form)) { setEditing(null); setForm({}) }
    setSaving(false)
  }

  async function remove(id: number) {
    setError(null)
    const res = await fetch(`/api/drivers/${id}`, { method: 'DELETE' })
    if (res.ok) {
      const updated = await res.json()
      setDrivers(prev => prev.map(d => (d.id === id ? updated : d)))
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not remove that driver')
    }
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>

  const onDutyCount = drivers.filter(d => d.active && d.onDuty).length

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {onDutyCount} on duty of {drivers.filter(d => d.active).length} active
        </p>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          <Plus size={14} /> Add driver
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {onDutyCount > PICKER_LIMIT && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {onDutyCount} drivers are on duty, but WhatsApp only shows {PICKER_LIMIT} in the
          allocation list. Set some off duty so the right ones appear.
        </div>
      )}

      {showAdd && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-gray-800">New driver</p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Field label="Name">
              <input className={inp} value={addForm.name ?? ''} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="WhatsApp number" hint="072 118 4460 or +27 72 118 4460">
              <input className={inp} value={addForm.phone ?? ''} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Registration">
              <input className={inp} value={addForm.plate ?? ''} onChange={e => setAddForm(f => ({ ...f, plate: e.target.value }))} />
            </Field>
            <Field label="Vehicle" hint="Guests use this to spot the car">
              <input className={inp} placeholder="white Toyota Quantum" value={addForm.vehicle ?? ''} onChange={e => setAddForm(f => ({ ...f, vehicle: e.target.value }))} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={add}
              disabled={saving || !addForm.name || !addForm.phone || !addForm.plate}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Add driver'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {drivers.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">No drivers yet.</p>
          <p className="mt-1 text-xs text-gray-400">A request cannot be allocated until there is at least one.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 font-medium">Driver</th>
                <th className="px-4 py-2.5 font-medium">WhatsApp</th>
                <th className="px-4 py-2.5 font-medium">Vehicle</th>
                <th className="px-4 py-2.5 font-medium">On duty</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => {
                const isEditing = editing === d.id
                return (
                  <tr key={d.id} className={cn('border-b border-gray-50 last:border-0', !d.active && 'opacity-50')}>
                    <td className="px-4 py-2.5">
                      {isEditing
                        ? <input className={inp} value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                        : <span className="font-medium text-gray-900">{d.name}</span>}
                      {!d.active && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">removed</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {isEditing
                        ? <input className={inp} value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                        : <span className="font-mono text-xs">{d.phone}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input className={inp} value={form.plate ?? ''} onChange={e => setForm(f => ({ ...f, plate: e.target.value }))} />
                          <input className={inp} value={form.vehicle ?? ''} onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))} />
                        </div>
                      ) : (
                        <>
                          <span className="font-mono text-xs">{d.plate}</span>
                          {d.vehicle && <span className="ml-2 text-gray-400">{d.vehicle}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => patch(d.id, { onDuty: !d.onDuty })}
                        disabled={!d.active}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40',
                          d.onDuty ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                        )}
                      >
                        {d.onDuty ? 'On duty' : 'Off duty'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={saveEdit} disabled={saving} className="rounded p-1.5 text-green-700 hover:bg-green-50"><Check size={15} /></button>
                          <button onClick={() => { setEditing(null); setForm({}) }} className="rounded p-1.5 text-gray-400 hover:bg-gray-50"><X size={15} /></button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setEditing(d.id); setForm({ ...d }) }} className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-700"><Edit2 size={14} /></button>
                          {d.active && (
                            <button onClick={() => remove(d.id)} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-700">Remove</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">
        {label}{hint && <span className="ml-1.5 text-gray-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
