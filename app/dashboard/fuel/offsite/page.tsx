'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Alloc = {
  id: number
  fillId: number
  allocType: 'onsite' | 'offsite'
  clientName: string | null
  billingInfo: string | null
  hoursWorked: string | null
  litres: string
  cost: string
  fillDate?: string
  ratePerLitre?: string
}

type Fill = {
  id: number
  fillDate: string
  driverName: string
  vehicle: string
  litres: string
  ratePerLitre: string
  status: string
  allocations: Alloc[]
}

type Invoice = {
  id: number
  invoiceNumber: string
  clientName: string
  billingInfo: string | null
  periodStart: string
  periodEnd: string
  hours: string
  tlbRate: string
  labourExclVat: string
  dieselLitres: string
  dieselRate: string
  dieselCost: string
  vatRate: string
  vatAmount: string
  totalDue: string
  paymentStatus: 'unpaid' | 'paid_cash' | 'paid_eft' | 'overdue'
  paidAt: string | null
  notes: string | null
}

type ClientSummary = {
  clientName: string
  billingInfo: string | null
  totalHours: number
  totalLitres: number
  totalDieselCost: number
  totalLabour: number
  entries: Array<{ date: string; hours: number; litres: number; cost: number; rate: number }>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TLB_RATE_DEFAULT = 4500 / 8  // R562.50/hr

function fmtZAR(n: number) {
  return `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShort(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

const STATUS_LABELS: Record<Invoice['paymentStatus'], string> = {
  unpaid:    'Unpaid',
  paid_cash: 'Paid (Cash)',
  paid_eft:  'Paid (EFT)',
  overdue:   'Overdue',
}

const STATUS_COLORS: Record<Invoice['paymentStatus'], string> = {
  unpaid:    'bg-yellow-100 text-yellow-800',
  paid_cash: 'bg-green-100 text-green-800',
  paid_eft:  'bg-blue-100 text-blue-800',
  overdue:   'bg-red-100 text-red-800',
}

// ── Invoice Modal ─────────────────────────────────────────────────────────────

function InvoiceModal({
  client,
  activeRate,
  defaultTlbRate,
  onClose,
  onSaved,
}: {
  client: ClientSummary
  activeRate: string
  defaultTlbRate: string
  onClose: () => void
  onSaved: () => void
}) {
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd,   setPeriodEnd]   = useState('')
  const [tlbRate,     setTlbRate]     = useState(defaultTlbRate)
  const [dieselRate,  setDieselRate]  = useState(activeRate)
  const [vatRate,     setVatRate]     = useState('15')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const labour   = client.totalHours  * parseFloat(tlbRate  || '0')
  const diesel   = client.totalLitres * parseFloat(dieselRate || '0')
  const subtotal = labour + diesel
  const vat      = subtotal * (parseFloat(vatRate || '0') / 100)
  const total    = subtotal + vat

  async function save() {
    if (!periodStart || !periodEnd) { setError('Enter period start and end'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/fuel-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName:  client.clientName,
          billingInfo: client.billingInfo,
          periodStart, periodEnd,
          hours:       client.totalHours,
          tlbRate:     parseFloat(tlbRate),
          dieselLitres: client.totalLitres,
          dieselRate:  parseFloat(dieselRate),
          vatRate:     parseFloat(vatRate),
          notes,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-lg font-bold text-gray-900">Create Invoice</h2>
          <p className="text-sm text-gray-500 mt-0.5">{client.clientName}</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Period Start</label>
              <input type="date" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3c2e]" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Period End</label>
              <input type="date" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3c2e]" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          {/* Rates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">TLB Rate (R/hr)</label>
              <input type="number" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3c2e]" value={tlbRate} onChange={e => setTlbRate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Diesel Rate (R/L)</label>
              <input type="number" className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3c2e]" value={dieselRate} onChange={e => setDieselRate(e.target.value)} />
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Labour ({client.totalHours.toFixed(1)} hrs × R{tlbRate}/hr)</span>
              <span className="font-semibold">{fmtZAR(labour)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Diesel ({client.totalLitres.toFixed(1)} L × R{dieselRate}/L)</span>
              <span className="font-semibold">{fmtZAR(diesel)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-gray-600">Subtotal (excl. VAT)</span>
              <span className="font-semibold">{fmtZAR(subtotal)}</span>
            </div>

            {/* VAT toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-gray-600">VAT %</span>
                <button
                  onClick={() => setVatRate(v => v === '0' ? '15' : '0')}
                  className={`text-xs px-2 py-0.5 rounded font-semibold ${vatRate === '0' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-700'}`}
                >
                  {vatRate === '0' ? 'Cash (0%)' : '15%'}
                </button>
              </div>
              <span className="font-semibold">{fmtZAR(vat)}</span>
            </div>

            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>Total Due</span>
              <span className="text-green-800">{fmtZAR(total)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Notes (optional)</label>
            <textarea className="field-input min-h-[60px]" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="p-6 border-t flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#1a3c2e] text-white font-semibold hover:bg-[#153226] disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Payment Status Modal ──────────────────────────────────────────────────────

function PaymentModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState(invoice.paymentStatus)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/fuel-invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentStatus: status,
          paidAt: status.startsWith('paid') ? new Date().toISOString() : null,
          paymentMethod: status === 'paid_cash' ? 'cash' : status === 'paid_eft' ? 'eft' : null,
        }),
      })
      onSaved(); onClose()
    } finally {
      setSaving(false)
    }
  }

  const options: Invoice['paymentStatus'][] = ['unpaid', 'paid_cash', 'paid_eft', 'overdue']

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="p-6 border-b">
          <h2 className="text-lg font-bold text-gray-900">Update Payment</h2>
          <p className="text-sm text-gray-500 mt-0.5">{invoice.invoiceNumber} · {invoice.clientName}</p>
        </div>
        <div className="p-6 space-y-2">
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => setStatus(opt)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 font-semibold text-sm transition ${
                status === opt ? 'border-[#1a3c2e] bg-[#f0f7f4]' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {STATUS_LABELS[opt]}
            </button>
          ))}
        </div>
        <div className="p-6 border-t flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-[#1a3c2e] text-white font-semibold disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OffsiteSummaryPage() {
  const [fills,    setFills]    = useState<Fill[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [activeRate, setActiveRate] = useState('28.36')
  const [tlbRate,    setTlbRate]    = useState(String(TLB_RATE_DEFAULT))
  const [loading,  setLoading]  = useState(true)
  const tlbRateNum = parseFloat(tlbRate) || TLB_RATE_DEFAULT

  const [createFor,  setCreateFor]  = useState<ClientSummary | null>(null)
  const [payFor,     setPayFor]     = useState<Invoice | null>(null)
  const [expandedClient, setExpandedClient] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [fillsRes, invoicesRes, purchasesRes] = await Promise.all([
        fetch('/api/fuel-fills'),
        fetch('/api/fuel-invoices'),
        fetch('/api/fuel-purchases'),
      ])
      const fillsData     = await fillsRes.json()
      const invoicesData  = await invoicesRes.json()
      const purchasesData = await purchasesRes.json()

      setFills(Array.isArray(fillsData) ? fillsData : [])
      setInvoices(Array.isArray(invoicesData) ? invoicesData : [])
      if (purchasesData.activeRate) setActiveRate(purchasesData.activeRate)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Group offsite allocations by client
  const clientMap = new Map<string, ClientSummary>()

  for (const fill of fills) {
    if (fill.status !== 'final') continue
    for (const alloc of fill.allocations) {
      if (alloc.allocType !== 'offsite' || !alloc.clientName) continue
      const key = alloc.clientName

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          clientName:      alloc.clientName,
          billingInfo:     alloc.billingInfo,
          totalHours:      0,
          totalLitres:     0,
          totalDieselCost: 0,
          totalLabour:     0,
          entries:         [],
        })
      }

      const c = clientMap.get(key)!
      const hrs  = parseFloat(alloc.hoursWorked ?? '0')
      const litres = parseFloat(alloc.litres)
      const cost   = parseFloat(alloc.cost)
      const rate   = parseFloat(fill.ratePerLitre)

      c.totalHours      += hrs
      c.totalLitres     += litres
      c.totalDieselCost += cost
      c.totalLabour     += hrs * tlbRateNum
      c.entries.push({ date: fill.fillDate, hours: hrs, litres, cost, rate })
    }
  }

  const clients = Array.from(clientMap.values()).sort((a, b) => a.clientName.localeCompare(b.clientName))

  // Summary stats
  const totalRecoverable = clients.reduce((s, c) => s + c.totalDieselCost + c.totalLabour, 0)
  const invoicedAmount   = invoices.reduce((s, i) => s + parseFloat(i.totalDue), 0)
  const outstanding      = invoices.filter(i => i.paymentStatus === 'unpaid' || i.paymentStatus === 'overdue')
    .reduce((s, i) => s + parseFloat(i.totalDue), 0)

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Off-site Summary</h1>
          <p className="text-sm text-gray-500 mt-1">Client diesel & labour breakdown · Diesel @ R{parseFloat(activeRate).toFixed(2)}/L</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm shrink-0">
          <div className="text-right mr-1">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">TLB Rate</p>
            <p className="text-[11px] text-gray-400">R/day = R{(tlbRateNum * 8).toFixed(0)}</p>
          </div>
          <span className="text-sm text-gray-400">R</span>
          <input
            type="number"
            step="0.01"
            value={tlbRate}
            onChange={e => setTlbRate(e.target.value)}
            className="w-24 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm font-semibold text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <span className="text-sm text-gray-400">/hr</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Recoverable</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtZAR(totalRecoverable)}</p>
          <p className="text-xs text-gray-400 mt-1">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Invoiced</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{fmtZAR(invoicedAmount)}</p>
          <p className="text-xs text-gray-400 mt-1">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outstanding</p>
          <p className={`text-2xl font-bold mt-1 ${outstanding > 0 ? 'text-red-600' : 'text-green-700'}`}>{fmtZAR(outstanding)}</p>
          <p className="text-xs text-gray-400 mt-1">unpaid + overdue</p>
        </div>
      </div>

      {/* Client breakdown */}
      <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Client Breakdown</h2>
          <span className="text-xs text-gray-400">From finalised allocations</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : clients.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No finalised off-site allocations yet.</div>
        ) : (
          <div className="divide-y">
            {clients.map(client => {
              const isOpen = expandedClient === client.clientName
              const invoiceForClient = invoices.filter(i => i.clientName === client.clientName)
              return (
                <div key={client.clientName}>
                  <button
                    className="w-full text-left px-6 py-4 hover:bg-gray-50 transition flex items-start justify-between gap-4"
                    onClick={() => setExpandedClient(isOpen ? null : client.clientName)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{client.clientName}</span>
                        {client.billingInfo && (
                          <span className="text-xs text-gray-400 truncate">{client.billingInfo}</span>
                        )}
                      </div>
                      <div className="flex gap-4 mt-1 text-sm text-gray-500">
                        <span>{client.totalHours.toFixed(1)} hrs</span>
                        <span>{client.totalLitres.toFixed(1)} L diesel</span>
                        <span>{client.entries.length} fill{client.entries.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">{fmtZAR(client.totalLabour + client.totalDieselCost)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">excl. VAT</p>
                    </div>
                    <span className="text-gray-400 mt-1">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div className="px-6 pb-5 bg-gray-50 space-y-4">
                      {/* Entry table */}
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase text-gray-400 border-b">
                            <th className="text-left py-2 font-semibold">Date</th>
                            <th className="text-right py-2 font-semibold">Hours</th>
                            <th className="text-right py-2 font-semibold">Labour</th>
                            <th className="text-right py-2 font-semibold">Diesel (L)</th>
                            <th className="text-right py-2 font-semibold">Diesel Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {client.entries.map((e, i) => (
                            <tr key={i} className="text-gray-700">
                              <td className="py-2">{fmtShort(e.date)}</td>
                              <td className="text-right py-2">{e.hours.toFixed(1)}</td>
                              <td className="text-right py-2">{fmtZAR(e.hours * tlbRateNum)}</td>
                              <td className="text-right py-2">{e.litres.toFixed(1)}</td>
                              <td className="text-right py-2">{fmtZAR(e.cost)}</td>
                            </tr>
                          ))}
                          <tr className="font-bold text-gray-900 border-t border-gray-300">
                            <td className="pt-3">Total</td>
                            <td className="text-right pt-3">{client.totalHours.toFixed(1)}</td>
                            <td className="text-right pt-3">{fmtZAR(client.totalLabour)}</td>
                            <td className="text-right pt-3">{client.totalLitres.toFixed(1)}</td>
                            <td className="text-right pt-3">{fmtZAR(client.totalDieselCost)}</td>
                          </tr>
                        </tbody>
                      </table>

                      {/* Invoice button */}
                      <div className="flex items-center justify-between pt-2">
                        <div className="text-sm">
                          <span className="text-gray-500">Subtotal excl. VAT: </span>
                          <span className="font-bold text-gray-900">{fmtZAR(client.totalLabour + client.totalDieselCost)}</span>
                        </div>
                        <button
                          onClick={() => setCreateFor(client)}
                          className="px-4 py-2 bg-[#1a3c2e] text-white text-sm font-semibold rounded-lg hover:bg-[#153226] transition"
                        >
                          + Create Invoice
                        </button>
                      </div>

                      {/* Existing invoices for this client */}
                      {invoiceForClient.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Invoices</p>
                          {invoiceForClient.map(inv => (
                            <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border">
                              <div>
                                <span className="text-sm font-semibold text-gray-800">{inv.invoiceNumber}</span>
                                <span className="text-xs text-gray-400 ml-2">{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-gray-900">{fmtZAR(parseFloat(inv.totalDue))}</span>
                                <button
                                  onClick={() => setPayFor(inv)}
                                  className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[inv.paymentStatus]}`}
                                >
                                  {STATUS_LABELS[inv.paymentStatus]}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* All invoices table */}
      {invoices.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="font-bold text-gray-900">All Invoices</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-xs uppercase text-gray-400">
                  <th className="text-left px-6 py-3 font-semibold">Invoice #</th>
                  <th className="text-left px-4 py-3 font-semibold">Client</th>
                  <th className="text-left px-4 py-3 font-semibold">Period</th>
                  <th className="text-right px-4 py-3 font-semibold">Hours</th>
                  <th className="text-right px-4 py-3 font-semibold">Diesel (L)</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                  <th className="text-center px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-xs text-gray-700">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{inv.clientName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(inv.periodStart)} – {fmtShort(inv.periodEnd)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{parseFloat(inv.hours).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{parseFloat(inv.dieselLitres).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">{fmtZAR(parseFloat(inv.totalDue))}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setPayFor(inv)}
                        className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[inv.paymentStatus]}`}
                      >
                        {STATUS_LABELS[inv.paymentStatus]}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {createFor && (
        <InvoiceModal
          client={createFor}
          activeRate={activeRate}
          defaultTlbRate={tlbRate}
          onClose={() => setCreateFor(null)}
          onSaved={load}
        />
      )}
      {payFor && (
        <PaymentModal
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}
