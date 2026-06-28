'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type Entity = { id: number; name: string; entityType: string }

const ENTITY_COLOURS: Record<string, string> = {
  kanaan:             'border-blue-300 bg-blue-50',
  plant_hire:         'border-amber-300 bg-amber-50',
  investment_project: 'border-purple-300 bg-purple-50',
}

export default function NewPayrollRunPage() {
  const router = useRouter()
  const now    = new Date()
  const y      = now.getFullYear()
  const m      = now.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()

  const [entities,     setEntities]     = useState<Entity[]>([])
  const [entityId,     setEntityId]     = useState<string>('')
  const [periodStart,  setPeriodStart]  = useState(`${y}-${String(m + 1).padStart(2,'0')}-01`)
  const [periodEnd,    setPeriodEnd]    = useState(`${y}-${String(m + 1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')

  useEffect(() => {
    fetch('/api/entities').then(r => r.json()).then((data: Entity[]) => {
      setEntities(data)
      if (data.length > 0) setEntityId(String(data[0].id))
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!entityId) { setError('Select an entity'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, periodStart, periodEnd }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Error'); setSaving(false); return }
    const run = await res.json()
    router.push(`/dashboard/payroll/${run.id}/setup`)
  }

  const inp = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-8 max-w-md">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">New Payroll Run</h1>
      <p className="text-sm text-gray-500 mb-6">Select entity and pay period. All active workers will be auto-populated.</p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Entity selector */}
        <div>
          <label className={lbl}>Entity *</label>
          <div className="grid gap-2">
            {entities.map(en => (
              <label key={en.id}
                className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 cursor-pointer transition-colors ${
                  entityId === String(en.id)
                    ? (ENTITY_COLOURS[en.entityType] ?? 'border-gray-400 bg-gray-50')
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}>
                <input type="radio" name="entity" value={en.id}
                  checked={entityId === String(en.id)}
                  onChange={() => setEntityId(String(en.id))}
                  className="accent-gray-800" />
                <span className="text-sm font-medium text-gray-800">{en.name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Period */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Period Start</label>
            <input type="date" className={inp} value={periodStart} onChange={e => setPeriodStart(e.target.value)} required />
          </div>
          <div>
            <label className={lbl}>Period End</label>
            <input type="date" className={inp} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} required />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !entityId}
            className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Run'}
          </button>
        </div>
      </form>
    </div>
  )
}
