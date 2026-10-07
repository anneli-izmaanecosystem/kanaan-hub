'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Phone, MapPin, CreditCard, AlertTriangle, CalendarDays } from 'lucide-react'
import { cn, formatPhone, getJson } from '@/lib/utils'

type Driver = { name: string; phone: string; plate: string; vehicle: string | null }
type Trip = {
  id: number; ref: string; direction: string; status: string
  guestPhone: string; guestName: string | null; roomLabel: string | null
  placeName: string | null; pickupName: string | null; distanceKm: string | null
  scheduledAt: string | null; createdAt: string; fare: string | null
  heldAt: string | null; capturedAt: string | null; releasedAt: string | null
  paymentMethod: 'card' | 'paystack' | null  // how a paid trip was paid: the driver's card machine, or Paystack
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

// The service filters by these (STATUS_FILTERS in whatsapp-backend/app/routers/dashboard.py).
// Cancelled, declined and no-show trips appear under All only.
const STATUS_FILTERS = [
  { value: 'all',       label: 'All' },
  { value: 'upcoming',  label: 'Upcoming' },   // waiting on you, or a driver allocated
  { value: 'running',   label: 'Running' },    // driver on the way, at pickup, or on the trip
  { value: 'completed', label: 'Completed' },
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]['value']

const SAST = 'Africa/Johannesburg'
const filterBox = 'rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-400'

/** 'Wed 7 Oct · 07:20' in farm time. */
function when(iso: string | null) {
  if (!iso) return 'time not set'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-ZA', { timeZone: SAST, weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-ZA', { timeZone: SAST, hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} · ${time}`
}

/** Today in farm time, moved by `offset` days, as YYYY-MM-DD. */
function sastDate(offset = 0) {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: SAST })
}

/** 'Wed 7 Oct 2026' for a YYYY-MM-DD day. */
function dayLabel(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-ZA', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function money(v: string | null) {
  return v == null ? '—' : `R ${Number(v).toLocaleString('en-ZA', { minimumFractionDigits: 0 })}`
}

/** What is happening to the guest's money, in words rather than three timestamps. */
function holdState(t: Trip): { label: string; tone: string } {
  if (t.capturedAt) return { label: t.paymentMethod === 'card' ? 'Paid — Card' : 'Paid — Paystack', tone: 'text-green-700' }
  if (t.releasedAt) return { label: 'Released', tone: 'text-gray-500' }
  if (t.heldAt)     return { label: 'Held',     tone: 'text-amber-700' }
  return { label: 'Not held', tone: 'text-gray-400' }
}

export default function TransfersTodayPage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [drivers, setDrivers] = useState<DriverRow[]>([])
  const [status, setStatus] = useState<StatusFilter>('all')
  const [day, setDay] = useState('')  // YYYY-MM-DD pickup day, '' for every day
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Kept apart from `error` (a refused action) so the 30s refresh does not clear that.
  const [loadError, setLoadError] = useState<string | null>(null)
  // A board still loading for the previous filters must not land over the current one.
  const latest = useRef(0)

  const load = useCallback(async () => {
    const call = ++latest.current
    try {
      const [t, d] = await Promise.all([
        getJson<Trip[]>(`/api/trips?status=${status}${day ? `&date=${day}` : ''}`),
        getJson<DriverRow[]>('/api/drivers'),
      ])
      if (call !== latest.current) return
      setTrips(t); setDrivers(d); setLoadError(null)
    } catch (err) {
      // The last board that loaded stays up under the warning.
      setLoadError((err as Error).message)
    }
    setLoading(false)
  }, [status, day])

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
  const filtered = status !== 'all' || day !== ''

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Status
            <select className={filterBox} value={status} onChange={e => setStatus(e.target.value as StatusFilter)}>
              {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <DateFilter value={day} onChange={setDay} />
        </div>
        <p className="text-xs text-gray-400">
          {trips.length} trip{trips.length === 1 ? '' : 's'}, newest request first ·{' '}
          {onDuty.length} driver{onDuty.length === 1 ? '' : 's'} on duty · refreshes every 30s
        </p>
      </div>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Could not load the board: {loadError}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {!loadError && onDuty.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No drivers are on duty, so there is nobody to allocate a request to.
        </div>
      )}

      {!loadError && trips.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <p className="text-sm text-gray-500">{filtered ? 'No trips match these filters.' : 'No trips yet.'}</p>
          <p className="mt-1 text-xs text-gray-400">
            Trips appear here the moment a guest finishes booking on WhatsApp.
          </p>
        </div>
      )}

      <TripList trips={trips} drivers={onDuty} act={act} busy={busy} />
    </div>
  )
}

/** The pickup-day filter: All, Today, Tomorrow, or any day picked from the calendar. */
function DateFilter({ value, onChange }: { value: string; onChange: (day: string) => void }) {
  const picker = useRef<HTMLInputElement>(null)
  const today = sastDate(0)
  const tomorrow = sastDate(1)

  function openCalendar() {
    try { picker.current?.showPicker() } catch { picker.current?.focus() }
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <label htmlFor="dispatch-day">Pickup date</label>
      <select id="dispatch-day" className={filterBox} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        <option value={today}>Today</option>
        <option value={tomorrow}>Tomorrow</option>
        {value && value !== today && value !== tomorrow && <option value={value}>{dayLabel(value)}</option>}
      </select>
      <div className="relative">
        <button
          type="button"
          onClick={openCalendar}
          aria-label="Pick a date"
          title="Pick a date"
          className="rounded-md border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
        >
          <CalendarDays size={16} />
        </button>
        {/* The browser's own calendar opens from this, under the button. */}
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

function TripList({
  trips, drivers, act, busy,
}: {
  trips: Trip[]
  drivers: DriverRow[]
  act: (id: number, action: string, extra?: Record<string, unknown>) => void
  busy: number | null
}) {
  return (
    <div className="flex flex-col gap-2">
      {trips.map(t => {
        const s = STATUS[t.status] ?? { label: t.status, tag: 'bg-gray-100 text-gray-600' }
        const hold = holdState(t)
        // Amber wants a decision; a trip that is over fades back.
        const highlight = NEEDS_ACTION.has(t.status)
        const muted = !highlight && !LIVE.has(t.status)

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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900">{t.ref}</span>
                  <span className={cn('rounded px-2 py-0.5 text-[11px] font-medium', s.tag)}>{s.label}</span>
                  <span className="text-xs text-gray-400 capitalize">{t.direction}</span>
                  <span className="text-xs text-gray-400">· requested {when(t.createdAt)}</span>
                </div>

                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-800">
                  <MapPin size={13} className="shrink-0 text-gray-400" />
                  {/* Set only for a trip between two other points; otherwise one end is the farm. */}
                  {t.pickupName && <span className="text-gray-500">{t.pickupName} →</span>}
                  {t.placeName ?? 'destination not set'}
                  {t.distanceKm && <span className="text-gray-400">· {Number(t.distanceKm)} km</span>}
                </p>

                <p className="mt-0.5 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{when(t.scheduledAt)}</span> ·{' '}
                  {t.guestName && <><span className="font-medium text-gray-700">{t.guestName}</span> · </>}
                  {t.roomLabel ?? 'room not given'} ·{' '}
                  <a href={`tel:${t.guestPhone}`} className="hover:text-gray-800 hover:underline">{formatPhone(t.guestPhone)}</a>
                </p>

                {t.driver && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
                    <Phone size={12} className="shrink-0 text-gray-400" />
                    {t.driver.name} ·{' '}
                    <a href={`tel:${t.driver.phone}`} className="hover:text-gray-800 hover:underline">{formatPhone(t.driver.phone)}</a>
                    {' '}· {t.driver.plate}
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
