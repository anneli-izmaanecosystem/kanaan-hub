'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { fmtDate } from '@/lib/utils'
import { Upload, FileText, Trash2, Download, Loader, ChevronDown } from 'lucide-react'

type Doc = {
  id: number; entityId: number; entityName: string
  category: 'coida' | 'uif' | 'payroll' | 'other'
  title: string; periodLabel: string | null
  fileName: string; fileType: string | null; notes: string | null
  uploadedBy: string | null; createdAt: string; url: string
}
type Entity = { id: number; name: string; tradingName: string | null }

const CATEGORY_LABEL: Record<Doc['category'], string> = {
  coida: 'COIDA', uif: 'UIF', payroll: 'Payroll', other: 'Other',
}
const CATEGORY_TAG: Record<Doc['category'], string> = {
  coida:   'bg-blue-100 text-blue-800',
  uif:     'bg-green-100 text-green-800',
  payroll: 'bg-purple-100 text-purple-800',
  other:   'bg-gray-100 text-gray-600',
}

export default function DocumentsPage() {
  const [docs,     setDocs]     = useState<Doc[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState<'all' | Doc['category']>('all')
  const [showForm, setShowForm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error,    setError]    = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const [d, e] = await Promise.all([
      fetch('/api/documents').then(r => r.json()),
      fetch('/api/entities').then(r => r.json()),
    ])
    setDocs(d)
    setEntities(e)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setUploading(true)
    const fd = new FormData(e.currentTarget)

    const res = await fetch('/api/documents', { method: 'POST', body: fd })
    const data = await res.json()

    if (!res.ok) { setError(data.error ?? 'Upload failed'); setUploading(false); return }

    setUploading(false)
    setShowForm(false)
    e.currentTarget.reset()
    load()
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this document? This cannot be undone.')) return
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' })
    if (res.ok) setDocs(prev => prev.filter(d => d.id !== id))
  }

  const filtered = filter === 'all' ? docs : docs.filter(d => d.category === filter)

  return (
    <div className="p-8">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <Link href="/dashboard/payroll" className="hover:text-gray-700">Payroll</Link>
        <span>/</span>
        <span className="text-gray-700">Documents</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Compliance Documents</h1>
          <p className="text-sm text-gray-500 mt-1">COIDA, UIF, and other payroll compliance paperwork — all in one place.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          <Upload size={15} /> Upload document
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleUpload} className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Entity</label>
              <select name="entityId" required defaultValue={entities[0]?.id ?? ''}
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300">
                {entities.map(e => <option key={e.id} value={e.id}>{e.tradingName ?? e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select name="category" defaultValue="coida"
                className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300">
                <option value="coida">COIDA</option>
                <option value="uif">UIF</option>
                <option value="payroll">Payroll</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input name="title" required placeholder="e.g. COIDA Return of Earnings — 2025/26"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Period (optional)</label>
            <input name="periodLabel" placeholder="e.g. Aug 2025 – Feb 2026"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input name="notes" placeholder="Anything worth flagging about this document"
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">File (PDF or image, max 15MB)</label>
            <input ref={fileRef} name="file" type="file" required accept=".pdf,image/*"
              className="w-full text-sm text-gray-600" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={uploading}
              className="flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
              {uploading ? <><Loader size={14} className="animate-spin" /> Uploading…</> : 'Upload'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Category filter */}
      <div className="flex gap-2 mb-4">
        {(['all', 'coida', 'uif', 'payroll', 'other'] as const).map(c => (
          <button key={c} onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <FileText size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-400">No documents yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm divide-y divide-gray-100">
          {filtered.map(doc => (
            <div key={doc.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
              <FileText size={18} className="text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{doc.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${CATEGORY_TAG[doc.category]}`}>
                    {CATEGORY_LABEL[doc.category]}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">
                  {doc.entityName}
                  {doc.periodLabel && ` · ${doc.periodLabel}`}
                  {` · uploaded ${fmtDate(doc.createdAt)}`}
                  {doc.uploadedBy && ` by ${doc.uploadedBy}`}
                </p>
                {doc.notes && <p className="text-xs text-gray-400 italic truncate mt-0.5">{doc.notes}</p>}
              </div>
              <a href={doc.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 flex-shrink-0">
                <Download size={12} /> View
              </a>
              <button onClick={() => handleDelete(doc.id)}
                className="text-gray-300 hover:text-red-500 flex-shrink-0">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
