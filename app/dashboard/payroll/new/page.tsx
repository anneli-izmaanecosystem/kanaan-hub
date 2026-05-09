'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function NewPayrollRunPage() {
  const router  = useRouter()
  const now     = new Date()
  const y       = now.getFullYear()
  const m       = now.getMonth()

  const [periodStart, setPeriodStart] = useState(`${y}-${String(m + 1).padStart(2,'0')}-01`)
  const [periodEnd,   setPeriodEnd]   = useState(new Date(y, m + 1, 0).toISOString().split('T')[0])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    const res = await fetch('/api/payroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart, periodEnd }),
    })
    if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Error'); setSaving(false); return }
    const run = await res.json()
    router.push(`/dashboard/payroll/${run.id}`)
  }

  const input = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300'

  return (
    <div className="p-8 max-w-md">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">New Payroll Run</h1>
      <p className="text-sm text-gray-500 mb-6">Select the pay period. All active employees will be auto-populated.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Period Start</label>
          <input type="date" className={input} value={periodStart} onChange={e => setPeriodStart(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Period End</label>
          <input type="date" className={input} value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => router.back()} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Run'}
          </button>
        </div>
      </form>
    </div>
  )
}
