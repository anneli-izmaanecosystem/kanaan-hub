'use client'

import { useState, useEffect, useCallback } from 'react'
import { Phone, MessageCircle, AlertTriangle } from 'lucide-react'
import { cn, formatPhone, getJson } from '@/lib/utils'

/** A guest who asked for a Day Trip in the WhatsApp chat. Day trips are not offered yet -
 *  the guest was told "coming soon" - so these are for the admin to follow up. */
type DayTripRequest = {
  id: string; phone: string; guestName: string | null
  requestType: string; status: string
  requestedFor: string; leaveNow: boolean; createdAt: string
}

// The same words and colours as the Dispatch board: `requested` is a guest's request
// waiting on the admin.
const STATUS: Record<string, { label: string; tag: string }> = {
  requested: { label: 'Waiting on you', tag: 'bg-amber-100 text-amber-800' },
}

const TYPE: Record<string, string> = { DAY_TRIP: 'Day Trip' }

function when(iso: string) {
  return new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function DayTripRequestsPage() {
  const [requests, setRequests] = useState<DayTripRequest[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getJson<{ count: number; requests: DayTripRequest[] }>('/api/day-trips')
      setRequests(data.requests); setCount(data.count)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Left open like the board, so a new request shows without a reload.
  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Day Trip Requests ({count})</h2>
          <p className="text-sm text-gray-500">
            Guests who chose <span className="font-medium text-gray-700">Day Trip</span> in the WhatsApp chat.
            Day trips are not bookable yet, so they were told it is coming soon.
          </p>
        </div>
        <p className="text-xs text-gray-400 whitespace-nowrap">refreshes every 30s</p>
      </div>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Could not load the day trip requests: {loadError}
        </div>
      )}

      {!loadError && requests.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">No day trip requests yet.</p>
        </div>
      )}

      {requests.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Full name</th>
                <th className="px-4 py-2.5">WhatsApp number</th>
                <th className="px-4 py-2.5">Request type</th>
                <th className="px-4 py-2.5">Date/time</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Wanted for</th>
                <th className="px-4 py-2.5">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map(r => {
                const s = STATUS[r.status] ?? { label: r.status, tag: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.guestName ?? 'Name not given'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-800">{formatPhone(r.phone)}</td>
                    <td className="px-4 py-3 text-gray-800">{TYPE[r.requestType] ?? r.requestType}</td>
                    <td className="px-4 py-3 text-gray-500">{when(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', s.tag)}>{s.label}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      {when(r.requestedFor)}
                      {r.leaveNow && <span className="ml-1 text-xs text-gray-400">(tapped Now)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 text-xs">
                        <a href={`tel:${r.phone}`} className="flex items-center gap-1 text-gray-600 hover:text-gray-900 hover:underline">
                          <Phone size={12} /> Call
                        </a>
                        <a href={`https://wa.me/${r.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-1 text-gray-600 hover:text-gray-900 hover:underline">
                          <MessageCircle size={12} /> WhatsApp
                        </a>
                      </div>
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
