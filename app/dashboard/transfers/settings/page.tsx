'use client'

import { useState, useEffect } from 'react'
import { AlertTriangle, Check } from 'lucide-react'

type Settings = {
  fareBase: number; farePerKm: number; fareMinimum: number
  maxChatKm: number; opsResponseMin: number; noShowWaitMin: number
  holdBeforeMin: number; driverNudgeMin: number
  chargeNoShow: boolean; noShowFee: number | null
  serviceStart: string | null; serviceEnd: string | null; maxLeadDays: number
  opsWhatsapp: string; opsPhone: string; opsEscalationWhatsapp: string | null
  muteOpsCommentary: boolean
}

const inp = 'w-full rounded border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'

export default function TransferSettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/transfer-settings').then(r => r.json()).then(setS)
  }, [])

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS(prev => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  async function save() {
    if (!s) return
    setSaving(true); setError(null)
    const res = await fetch('/api/transfer-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    })
    if (res.ok) { setS(await res.json()); setSaved(true) }
    else setError((await res.json().catch(() => ({}))).error ?? 'Could not save')
    setSaving(false)
  }

  if (!s) return <div className="text-sm text-gray-400">Loading…</div>

  // The example fare from the original screens, recomputed live so a rate change can be
  // sanity-checked against a trip everyone already knows the price of.
  const example = Math.max(s.fareMinimum, Math.round((s.fareBase + s.farePerKm * 34) / 10) * 10)

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <Card
        title="Fares"
        note="These started as placeholders reverse-engineered from a single example. Set your real rate card before taking a booking."
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Base fare" prefix="R">
            <input className={inp} type="number" value={s.fareBase} onChange={e => set('fareBase', Number(e.target.value))} />
          </Field>
          <Field label="Per kilometre" prefix="R">
            <input className={inp} type="number" step="0.25" value={s.farePerKm} onChange={e => set('farePerKm', Number(e.target.value))} />
          </Field>
          <Field label="Minimum fare" prefix="R">
            <input className={inp} type="number" value={s.fareMinimum} onChange={e => set('fareMinimum', Number(e.target.value))} />
          </Field>
        </div>
        <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
          A 34 km run to Phabeni Gate would quote <span className="font-semibold text-gray-900">R {example}</span>.
          Destinations with a fixed fare ignore this.
        </p>
      </Card>

      <Card title="What the bot will and will not take">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Furthest bookable" suffix="km" hint="past this, the guest is told to call you">
            <input className={inp} type="number" value={s.maxChatKm} onChange={e => set('maxChatKm', Number(e.target.value))} />
          </Field>
          <Field label="Book no further ahead than" suffix="days">
            <input className={inp} type="number" value={s.maxLeadDays} onChange={e => set('maxLeadDays', Number(e.target.value))} />
          </Field>
          <Field label="Earliest departure" hint="blank for any time">
            <input className={inp} placeholder="05:00" value={s.serviceStart ?? ''} onChange={e => set('serviceStart', e.target.value || null)} />
          </Field>
          <Field label="Latest departure">
            <input className={inp} placeholder="22:00" value={s.serviceEnd ?? ''} onChange={e => set('serviceEnd', e.target.value || null)} />
          </Field>
        </div>
      </Card>

      <Card title="Timing" note="Minutes before departure that each automatic message goes out.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hold the card" suffix="min before">
            <input className={inp} type="number" value={s.holdBeforeMin} onChange={e => set('holdBeforeMin', Number(e.target.value))} />
          </Field>
          <Field label="Nudge the driver" suffix="min before">
            <input className={inp} type="number" value={s.driverNudgeMin} onChange={e => set('driverNudgeMin', Number(e.target.value))} />
          </Field>
          <Field label="Chase you if no answer" suffix="min" hint="after a guest requests a car">
            <input className={inp} type="number" value={s.opsResponseMin} onChange={e => set('opsResponseMin', Number(e.target.value))} />
          </Field>
          <Field label="Driver waits" suffix="min" hint="before you are asked what to do">
            <input className={inp} type="number" value={s.noShowWaitMin} onChange={e => set('noShowWaitMin', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card
        title="No-shows"
        note="Undecided in the message set. While this is off, a hold on a guest who never appeared is released rather than taken."
      >
        <label className="flex items-center gap-2.5 text-sm text-gray-800">
          <input type="checkbox" className="h-4 w-4 accent-gray-900" checked={s.chargeNoShow} onChange={e => set('chargeNoShow', e.target.checked)} />
          Charge a fee when the guest does not appear
        </label>
        {s.chargeNoShow && (
          <div className="mt-3 w-48">
            <Field label="No-show fee" prefix="R">
              <input className={inp} type="number" value={s.noShowFee ?? ''} onChange={e => set('noShowFee', e.target.value === '' ? null : Number(e.target.value))} />
            </Field>
          </div>
        )}
      </Card>

      <Card title="Where requests go">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your WhatsApp number" hint="new requests land here">
            <input className={inp} value={s.opsWhatsapp} onChange={e => set('opsWhatsapp', e.target.value)} />
          </Field>
          <Field label="Number quoted to guests" hint="shown when the bot hands off">
            <input className={inp} value={s.opsPhone} onChange={e => set('opsPhone', e.target.value)} />
          </Field>
          <Field label="Backup number" hint="chased if you have not answered">
            <input className={inp} value={s.opsEscalationWhatsapp ?? ''} onChange={e => set('opsEscalationWhatsapp', e.target.value || null)} />
          </Field>
        </div>
        {!s.opsEscalationWhatsapp && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            With no backup number, a request that arrives while you are asleep waits until
            you wake up and the guest simply sits there.
          </p>
        )}
        <label className="mt-4 flex items-start gap-2.5 text-sm text-gray-800">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-gray-900" checked={s.muteOpsCommentary} onChange={e => set('muteOpsCommentary', e.target.checked)} />
          <span>
            Mute the running commentary
            <span className="mt-0.5 block text-xs text-gray-500">
              Stops the four “nothing needed from you” updates per trip. Requests, no-shows
              and card problems still come through. You can read the rest on the Today board.
            </span>
          </span>
        </label>
      </Card>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-1 py-4">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-700">
            <Check size={15} /> Saved
          </span>
        )}
      </div>
    </div>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {note && <p className="mb-4 mt-1 max-w-xl text-xs text-gray-500">{note}</p>}
      <div className={note ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

function Field({
  label, hint, prefix, suffix, children,
}: {
  label: string; hint?: string; prefix?: string; suffix?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-gray-500">
        {prefix && <span className="mr-0.5 text-gray-400">{prefix}</span>}
        {label}
        {suffix && <span className="ml-1 text-gray-400">({suffix})</span>}
        {hint && <span className="ml-1.5 text-gray-400">— {hint}</span>}
      </label>
      {children}
    </div>
  )
}
