'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'

type Room = { id: number; name: string; type: string; icalUrl: string | null }
type SyncResult = {
  syncedAt: string
  rooms: { roomId: number; roomName: string; created: number; updated: number; cancelled: number; error?: string }[]
}

export default function IcalSyncSettingsPage() {
  const [rooms, setRooms]     = useState<Room[]>([])
  const [urls, setUrls]       = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult]   = useState<SyncResult | null>(null)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch('/api/rooms').then(r => r.json()).then((data: Room[]) => {
      setRooms(data)
      setUrls(Object.fromEntries(data.map(r => [r.id, r.icalUrl ?? ''])))
    })
  }, [])

  async function saveUrl(roomId: number) {
    setSavingId(roomId); setError('')
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icalUrl: urls[roomId]?.trim() || null }),
      })
      if (!res.ok) setError('Failed to save URL')
    } catch { setError('Network error') }
    setSavingId(null)
  }

  async function runSync() {
    setSyncing(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/ical-sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Sync failed'); setSyncing(false); return }
      setResult(data)
    } catch { setError('Network error') }
    setSyncing(false)
  }

  const configuredCount = rooms.filter(r => urls[r.id]?.trim()).length

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/dashboard/bookings" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft size={14} /> Back to Bookings
      </Link>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Booking.com Sync</h1>
      <p className="text-sm text-gray-500 mb-6">
        Paste each room's Booking.com calendar export URL (Extranet → Rates &amp; Availability → Sync calendars) to pull
        reservations in automatically. This is one-way and availability-only — guest names, contact details and prices
        still need to be filled in manually on each booking.
      </p>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 mb-6">
        {rooms.map(room => (
          <div key={room.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-32 shrink-0 text-sm font-medium text-gray-700">{room.name}</span>
            <input
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
              placeholder="https://ical.booking.com/v1/export?t=..."
              value={urls[room.id] ?? ''}
              onChange={e => setUrls(u => ({ ...u, [room.id]: e.target.value }))}
            />
            <button
              onClick={() => saveUrl(room.id)}
              disabled={savingId === room.id}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {savingId === room.id ? 'Saving…' : 'Save'}
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={runSync}
          disabled={syncing || configuredCount === 0}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </button>
        <span className="text-xs text-gray-400">{configuredCount} room{configuredCount === 1 ? '' : 's'} configured</span>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm">
          <p className="text-xs text-gray-400 mb-2">Synced at {new Date(result.syncedAt).toLocaleString('en-ZA')}</p>
          {result.rooms.length === 0 ? (
            <p className="text-gray-500">No rooms have a calendar URL configured.</p>
          ) : (
            <ul className="space-y-1">
              {result.rooms.map(r => (
                <li key={r.roomId} className="flex justify-between">
                  <span className="text-gray-700">{r.roomName}</span>
                  {r.error
                    ? <span className="text-red-600">{r.error}</span>
                    : <span className="text-gray-500">{r.created} new · {r.updated} updated · {r.cancelled} cancelled</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-6">
        For automatic hourly syncing without opening this page, a Vercel Cron job is configured to call this sync —
        set a <code className="bg-gray-100 px-1 rounded">CRON_SECRET</code> environment variable in Vercel to secure it.
      </p>
    </div>
  )
}
