'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cn, fmtDate } from '@/lib/utils'

type Purchase = {
  id: number
  purchaseDate: string
  supplier: string
  invoiceNo: string | null
  docketNo: string | null
  litres: string
  pricePerLitre: string
  totalExclVat: string
  vatRate: string
  totalInclVat: string
  notes: string | null
}

export default function FuelPurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [activeRate, setActiveRate] = useState<string | null>(null)
  const [activeRateDate, setActiveRateDate] = useState<string | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const [form, setForm] = useState({
    purchaseDate: new Date().toISOString().split('T')[0],
    supplier: 'Bosbok Gas Nelspruit',
    invoiceNo: '',
    docketNo: '',
    litres: '',
    pricePerLitre: '',
    vatRate: '0',
    notes: '',
  })

  useEffect(() => {
    fetch('/api/fuel-purchases').then(r => r.json()).then(d => {
      setPurchases(d.purchases ?? [])
      setActiveRate(d.activeRate ?? null)
      setActiveRateDate(d.activeRateDate ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function set(key: string, val: string) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  const litres    = parseFloat(form.litres) || 0
  const rate      = parseFloat(form.pricePerLitre) || 0
  const vatRate   = parseFloat(form.vatRate) || 0
  const exclVat   = litres * rate
  const inclVat   = exclVat * (1 + vatRate / 100)

  async function save() {
    if (!form.litres || !form.pricePerLitre) { setError('Litres and price per litre are required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/fuel-purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseDate: form.purchaseDate,
          supplier: form.supplier,
          invoiceNo: form.invoiceNo || null,
          docketNo: form.docketNo || null,
          litres: parseFloat(form.litres),
          pricePerLitre: parseFloat(form.pricePerLitre),
          vatRate: parseFloat(form.vatRate),
          notes: form.notes || null,
        }),
      })
      if (!res.ok) { const e = await res.json(); setError(e.error); return }
      const row = await res.json()
      setPurchases(prev => [row, ...prev])
      setActiveRate(row.pricePerLitre)
      setActiveRateDate(row.purchaseDate)
      setForm(prev => ({ ...prev, litres: '', invoiceNo: '', docketNo: '', notes: '' }))
    } finally { setSaving(false) }
  }

  const totalLitres = purchases.reduce((s, p) => s + parseFloat(p.litres), 0)
  const totalSpend  = purchases.reduce((s, p) => s + parseFloat(p.totalExclVat), 0)

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <Link href="/dashboard/fuel" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
          <ChevronLeft size={15} /> Fuel Log
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-semibold text-gray-900">Fuel Purchases</h1>
      </div>

      {/* Active rate callout */}
      {activeRate && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-blue-600 font-semibold uppercase tracking-wide">Active Rate</p>
            <p className="text-3xl font-bold text-blue-800 mt-0.5">R {parseFloat(activeRate).toFixed(2)} <span className="text-base font-normal">/ litre</span></p>
            {activeRateDate && <p className="text-xs text-blue-500 mt-0.5">Set {fmtDate(activeRateDate)} — applies to all new fill entries</p>}
          </div>
          <div className="text-4xl opacity-20">⛽</div>
        </div>
      )}

      <div className="grid grid-cols-[380px_1fr] gap-6">

        {/* Form */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Record Bulk Delivery</h2>
            <p className="text-xs text-gray-400 mt-0.5">Saving will update the active R/litre rate</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Date</label>
              <input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Supplier</label>
              <input value={form.supplier} onChange={e => set('supplier', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Invoice No.</label>
                <input value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)}
                  placeholder="e.g. INA48417" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Docket No.</label>
                <input value={form.docketNo} onChange={e => set('docketNo', e.target.value)}
                  placeholder="e.g. 14139" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Litres Delivered</label>
                <input type="number" value={form.litres} onChange={e => set('litres', e.target.value)}
                  placeholder="e.g. 800" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Price per Litre (R)</label>
                <input type="number" step="0.01" value={form.pricePerLitre} onChange={e => set('pricePerLitre', e.target.value)}
                  placeholder="e.g. 28.36" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">VAT %</label>
                <input type="number" value={form.vatRate} onChange={e => set('vatRate', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            </div>

            {/* Auto totals */}
            {litres > 0 && rate > 0 && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                {[
                  { label: 'Total excl VAT', value: `R ${exclVat.toFixed(2)}` },
                  { label: `VAT (${vatRate}%)`, value: `R ${(inclVat - exclVat).toFixed(2)}` },
                  { label: 'Total incl VAT', value: `R ${inclVat.toFixed(2)}`, bold: true },
                ].map(r => (
                  <div key={r.label} className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-gray-500">{r.label}</span>
                    <span className={cn('tabular-nums', r.bold ? 'font-bold text-gray-900' : 'text-gray-700')}>{r.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">Notes</label>
              <input value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="Any notes…" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button onClick={save} disabled={saving}
              className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Delivery & Update Rate'}
            </button>
          </div>
        </div>

        {/* History table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Purchase History</h2>
            <span className="text-xs text-gray-400">{purchases.length} deliveries · {totalLitres.toFixed(0)}L total</span>
          </div>

          {loading ? (
            <p className="p-6 text-sm text-gray-400">Loading…</p>
          ) : purchases.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-gray-400">No purchases recorded yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Supplier</th>
                  <th className="px-4 py-3 text-left font-medium">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium">Docket</th>
                  <th className="px-4 py-3 text-right font-medium">Litres</th>
                  <th className="px-4 py-3 text-right font-medium">R/L</th>
                  <th className="px-4 py-3 text-right font-medium">Total excl VAT</th>
                  <th className="px-4 py-3 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchases.map((p, i) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fmtDate(p.purchaseDate)}</td>
                    <td className="px-4 py-3 text-gray-700">{p.supplier}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.invoiceNo ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.docketNo ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{parseFloat(p.litres).toFixed(0)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-semibold', i === 0 ? 'text-blue-700' : 'text-gray-500')}>
                      R {parseFloat(p.pricePerLitre).toFixed(2)}
                      {i === 0 && <span className="ml-1 text-[10px] font-normal text-blue-400">active</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">R {parseFloat(p.totalExclVat).toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-200 text-xs font-semibold">
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-gray-500">TOTALS</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totalLitres.toFixed(0)}</td>
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums">R {totalSpend.toFixed(2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
