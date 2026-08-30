'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type InvoiceUpload = {
  id: number
  imageUrl: string
  note: string | null
  status: 'pending' | 'processed'
  createdAt: string
  processedAt: string | null
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function InvoicesInboxPage() {
  const [rows, setRows] = useState<InvoiceUpload[]>([])
  const [loading, setLoading] = useState(true)
  const [showProcessed, setShowProcessed] = useState(false)

  useEffect(() => {
    fetch('/api/invoice-uploads').then(r => r.json()).then(d => {
      setRows(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function setStatus(id: number, status: 'pending' | 'processed') {
    const res = await fetch(`/api/invoice-uploads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) return
    const updated = await res.json()
    setRows(prev => prev.map(r => r.id === id ? updated : r))
  }

  const visible = rows.filter(r => showProcessed || r.status === 'pending')
  const pendingCount = rows.filter(r => r.status === 'pending').length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invoices Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">Photos submitted from the mobile app, awaiting processing</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={showProcessed} onChange={e => setShowProcessed(e.target.checked)} />
          Show processed
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-400">
          {pendingCount === 0 ? 'No pending invoices — all caught up.' : 'Nothing to show.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {visible.map(row => (
            <div key={row.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
              <a href={row.imageUrl} target="_blank" rel="noopener noreferrer">
                <img src={row.imageUrl} alt="Invoice" className="w-full h-40 object-cover bg-gray-100" />
              </a>
              <div className="p-3">
                <p className="text-xs text-gray-400">{fmt(row.createdAt)}</p>
                {row.note && <p className="text-sm text-gray-700 mt-1">{row.note}</p>}
                <div className="mt-3 flex items-center justify-between">
                  <span className={cn(
                    'text-xs font-medium rounded-full px-2 py-0.5',
                    row.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800',
                  )}>
                    {row.status === 'pending' ? 'Pending' : 'Processed'}
                  </span>
                  <button
                    onClick={() => setStatus(row.id, row.status === 'pending' ? 'processed' : 'pending')}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {row.status === 'pending' ? 'Mark processed' : 'Reopen'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
