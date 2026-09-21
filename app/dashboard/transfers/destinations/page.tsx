'use client'

import { useState, useEffect } from 'react'
import { Plus, Edit2, Check, X, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Destination = {
  id: number; name: string; aliases: string | null
  lat: string; lng: string; fixedFare: string | null; active: boolean
  distanceKm: number; durationMin: number
}

const inp = 'w-full rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'

export default function DestinationsPage() {
  const [rows, setRows] = useState<Destination[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<Record<string, unknown>>({ active: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/destinations').then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function add() {
    setSaving(true); setError(null)
    const res = await fetch('/api/destinations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      const created = await res.json()
      setRows(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAdd(false); setAddForm({ active: true })
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not add that destination')
    }
    setSaving(false)
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true); setError(null)
    const res = await fetch(`/api/destinations/${editing}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const updated = await res.json()
      setRows(prev => prev.map(r => (r.id === editing ? updated : r)))
      setEditing(null); setForm({})
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not save that change')
    }
    setSaving(false)
  }

  async function remove(id: number) {
    const res = await fetch(`/api/destinations/${id}`, { method: 'DELETE' })
    if (res.ok) setRows(prev => prev.filter(r => r.id !== id))
    else setError('Could not remove that destination')
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-gray-500">
          Places guests can ask for by name. Aliases are what the bot actually matches
          against, so add every phrasing you see in the chat logs.
        </p>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          <Plus size={14} /> Add destination
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {showAdd && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 text-sm font-semibold text-gray-800">New destination</p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <Field label="Name" hint="quoted back to the guest">
              <input className={inp} placeholder="Phabeni Gate, Kruger National Park"
                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Aliases" hint="comma separated">
              <input className={inp} placeholder="phabeni, the gate"
                onChange={e => setAddForm(f => ({ ...f, aliases: e.target.value }))} />
            </Field>
            <Field label="Latitude">
              <input className={inp} placeholder="-25.0075" onChange={e => setAddForm(f => ({ ...f, lat: e.target.value }))} />
            </Field>
            <Field label="Longitude">
              <input className={inp} placeholder="31.2394" onChange={e => setAddForm(f => ({ ...f, lng: e.target.value }))} />
            </Field>
            <Field label="Fixed fare" hint="optional — overrides per-km">
              <input className={inp} placeholder="480" onChange={e => setAddForm(f => ({ ...f, fixedFare: e.target.value }))} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={add} disabled={saving}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Add destination'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">No destinations yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            Until one exists the bot falls back to its built-in list of Hazyview landmarks.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 font-medium">Destination</th>
                <th className="px-4 py-2.5 font-medium">Matches on</th>
                <th className="px-4 py-2.5 font-medium text-right">Distance</th>
                <th className="px-4 py-2.5 font-medium text-right">Fare</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const isEditing = editing === d.id
                return (
                  <tr key={d.id} className={cn('border-b border-gray-50 last:border-0', !d.active && 'opacity-50')}>
                    <td className="px-4 py-2.5">
                      {isEditing
                        ? <input className={inp} value={String(form.name ?? '')} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                        : <span className="font-medium text-gray-900">{d.name}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing
                        ? <input className={inp} value={String(form.aliases ?? '')} onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))} />
                        : <span className="text-xs text-gray-500">{d.aliases || <span className="text-gray-300">name only</span>}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                      {d.distanceKm} km
                      <span className="ml-1 text-xs text-gray-400">{d.durationMin} min</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {isEditing ? (
                        <input className={inp} value={String(form.fixedFare ?? '')} onChange={e => setForm(f => ({ ...f, fixedFare: e.target.value }))} />
                      ) : d.fixedFare ? (
                        <span className="font-medium text-gray-900">R {Number(d.fixedFare)}</span>
                      ) : (
                        <span className="text-xs text-gray-400">per km</span>
                      )}
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
                          <button onClick={() => remove(d.id)} className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-700">Remove</button>
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
