'use client'

import { useState, useEffect, useCallback } from 'react'
import { Phone, MapPin, CreditCard, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Driver = { name: string; phone: string; plate: string; vehicle: string | null }
type Trip = {
  id: number; ref: string; direction: string; status: string
  guestPhone: string; guestName: string | null; roomLabel: string | null
  placeName: string | null; distanceKm: string | null
  scheduledAt: string | null; fare: string | null
  heldAt: string | null; capturedAt: string | null; releasedAt: string | null
  driver: Driver | null
}
type DriverRow = { id: number; name: string; plate: string; onDuty: boolean; active: boolean }

// Colour carries the same meaning as the word, so a glance down the column is enough:
// amber wants a decision, blue is moving, green is done, grey is over.
const STATUS: Record<string, { label: string; tag: string }> = {
  requested:       { label: 'Waiting on you',   tag: 'bg-amber-100 text-amber-800' },
  allocated:       { label: 'Driver allocated', tag: 'bg-blue-100 text-blue-800' },
  driver_en_route: { label: 'On the way',       tag: 'bg-blue-100 text-blue-800' },
  driver_waiting:  { label: 'At pickup',        tag: 'bg-blue-100 text-blue-800' },
  in_progress:     { label: 'On the trip',      tag: 'bg-indigo-100 text-indigo-800' },
  completed:       { label: 'Completed',        tag: 'bg-green-100 text-green-800' },
  cancelled:       { label: 'Cancelled',        tag: 'bg-gray-100 text-gray-600' },
  declined:        { label: 'No car',           tag: 'bg-gray-100 text-gray-600' },
  no_show:         { label: 'No show',          tag: 'bg-red-100 text-red-800' },
  draft:           { label: 'Abandoned',        tag: 'bg-gray-100 text-gray-500' },
}

const NEEDS_ACTION = new Set(['requested', 'no_show'])
const LIVE = new Set(['requested', 'allocated', 'driver_en_route', 'driver_waiting', 'in_progress'])

function time(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function money(v: string | null) {
  return v == null ? '—' : `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`
}

/** What is happening to the guest's money, in words rather than three timestamps. */
function holdState(t: Trip): { label: string; tone: string } {
  if (t.capturedAt) return { label: 'Charged',  tone: 'text-green-700' }
  if (t.releasedAt) return { label: 'Released', tone: 'text-gray-500' }
  if (t.heldAt)     return { label: 'Held',     tone: 'text-amber-700' }
  return { label: 'Not held', tone: 'text-gray-400' }
}

export default function TransfersTodayPage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [scope, setScope] = useState<'today' | 'open' | 'all'>('today')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [t, d] = await Promise.all([
      fetch(`/api/trips?scope=${scope}`).then(r => r.json()),
      fetch('/api/drivers').then(r => r.json()),
    ])
    setTrips(Array.isArray(t) ? t : [])
    setDrivers(Array.isArray(d) ? d : [])
    setLoading(false)
  }, [scope])

  useEffect(() => { load() }, [load])

  // The board is left open while trips run, so it refreshes itself rather than making
  // the owner reload to find out a driver has set off.
  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  async function act(tripId: number, action: string, extra: Record<string, unknown> = {}) {
    setBusy(tripId); setError(null)
    const res = await fetch(`/api/trips/${tripId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? 'That did not work')
    else await load()
    setBusy(null)
  }

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>

  const onDuty = drivers.filter(d => d.active && d.onDuty)
  const waiting = trips.filter(t => NEEDS_ACTION.has(t.status))
  const live = trips.filter(t => LIVE.has(t.status) && !NEEDS_ACTION.has(t.status))
  const done = trips.filter(t => !LIVE.has(t.status) && !NEEDS_ACTION.has(t.status))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          {(['today', 'open', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                scope === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {onDuty.length} driver{onDuty.length === 1 ? '' : 's'} on duty · refreshes every 30s
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {onDuty.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No drivers are on duty, so there is nobody to allocate a request to.
        </div>
      )}

      {trips.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">No trips {scope === 'today' ? 'today' : 'yet'}.</p>
          <p className="mt-1 text-xs text-gray-400">
            Trips appear here the moment a guest finishes booking on WhatsApp.
          </p>
        </div>
      )}

      <Section title="Needs a decision" trips={waiting} drivers={onDuty} act={act} busy={busy} highlight />
      <Section title="Running now"      trips={live}    drivers={onDuty} act={act} busy={busy} />
      <Section title="Finished"         trips={done}    drivers={onDuty} act={act} busy={busy} muted />
    </div>
  )
}

function Section({
  title, trips, drivers, act, busy, highlight, muted,
}: {
  title: string
  trips: Trip[]
  drivers: DriverRow[]
  act: (id: number, action: string, extra?: Record<string, unknown>) => void
  busy: number | null
  highlight?: boolean
  muted?: boolean
}) {
  if (trips.length === 0) return null

  return (
    <section className="mb-7">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title} <span className="ml-1 font-normal text-gray-400">{trips.length}</span>
      </h2>

      <div className="flex flex-col gap-2">
        {trips.map(t => {
          const s = STATUS[t.status] ?? { label: t.status, tag: 'bg-gray-100 text-gray-600' }
          const hold = holdState(t)

          return (
            <div
              key={t.id}
              className={cn(
                'rounded-xl border bg-white p-4 shadow-sm',
                highlight ? 'border-amber-300' : 'border-gray-200',
                muted && 'opacity-70',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">{t.ref}</span>
                    <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', s.tag)}>{s.label}</span>
                    <span className="text-xs text-gray-400 capitalize">{t.direction}</span>
                  </div>

                  <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-800">
                    <MapPin size={13} className="shrink-0 text-gray-400" />
                    {t.placeName ?? 'destination not set'}
                    {t.distanceKm && <span className="text-gray-400">· {Number(t.distanceKm)} km</span>}
                  </p>

                  <p className="mt-0.5 text-xs text-gray-500">
                    {time(t.scheduledAt)} · {t.roomLabel ?? 'room not given'} ·{' '}
                    <a href={`tel:${t.guestPhone}`} className="hover:text-gray-800 hover:underline">{t.guestPhone}</a>
                  </p>

                  {t.driver && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
                      <Phone size={12} className="shrink-0 text-gray-400" />
                      {t.driver.name} · {t.driver.plate}
                      {t.driver.vehicle && <span className="text-gray-400">· {t.driver.vehicle}</span>}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{money(t.fare)}</p>
                  <p className={cn('flex items-center justify-end gap-1 text-[11px]', hold.tone)}>
                    <CreditCard size={11} /> {hold.label}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                {t.status === 'requested' && (
                  <select
                    className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                    defaultValue=""
                    disabled={busy === t.id || drivers.length === 0}
                    onChange={e => e.target.value && act(t.id, 'allocate', { driverId: Number(e.target.value) })}
                  >
                    <option value="">Allocate a driver…</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>{d.name} — {d.plate}</option>
                    ))}
                  </select>
                )}

                {LIVE.has(t.status) && (
                  <>
                    <Action onClick={() => act(t.id, 'complete')} disabled={busy === t.id}>Mark complete</Action>
                    <Action onClick={() => act(t.id, 'no_show')} disabled={busy === t.id}>No show</Action>
                    <Action onClick={() => act(t.id, 'cancel')} disabled={busy === t.id} danger>Cancel trip</Action>
                  </>
                )}

                {!LIVE.has(t.status) && !t.driver && t.status !== 'cancelled' && (
                  <span className="text-xs text-gray-400">Nothing to do.</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Action({
  onClick, disabled, danger, children,
}: {
  onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
        danger
          ? 'border-red-200 text-red-700 hover:bg-red-50'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  )
}
