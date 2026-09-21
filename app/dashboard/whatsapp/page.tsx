'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, RefreshCw, User, Car, Headset, FileText, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

// Every message exchanged with the WhatsApp number, read back as a thread. The chat list
// on the left is one row per phone; the right-hand pane is that number's full history
// with the bot, including the template cards and button choices it was sent.

type Chat = {
  phone: string
  lastAt: string
  count: number
  inbound: number
  lastBody: string | null
  lastDirection: string | null
  role: string | null
  step: string | null
  guestName: string | null
  trip: { ref: string; status: string } | null
}

type Message = {
  id: number
  direction: 'inbound' | 'outbound'
  role: string
  kind: string
  templateName: string | null
  body: string | null
  payload: string | null
  tripId: number | null
  createdAt: string
}

type TripEvent = { id: number; actor: string; event: string; detail: string | null; at: string }
type Trip = {
  id: number; ref: string; status: string; direction: string
  guestName: string | null; placeName: string | null; scheduledAt: string | null
  fare: string | null; events: TripEvent[]
}

type Thread = { phone: string; messages: Message[]; conversation: { step: string; tripId: number | null } | null; trips: Trip[] }

const ROLE: Record<string, { label: string; icon: typeof User; tone: string }> = {
  guest:  { label: 'Guest',  icon: User,    tone: 'bg-emerald-100 text-emerald-800' },
  ops:    { label: 'Anneli', icon: Headset, tone: 'bg-amber-100 text-amber-800' },
  driver: { label: 'Driver', icon: Car,     tone: 'bg-blue-100 text-blue-800' },
}

const POLL_MS = 5000

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false })
}

function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short' })
}

function whenOf(iso: string) {
  const d = new Date(iso)
  const today = new Date().toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })
  return d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' }) === today ? timeOf(iso) : dayOf(iso)
}

/** The buttons or list rows a sent card offered, pulled back out of the payload. */
function choicesOf(m: Message): string[] {
  if (!m.payload) return []
  try {
    const p = JSON.parse(m.payload)
    const i = p.interactive
    if (i?.action?.buttons) return i.action.buttons.map((b: { reply: { title: string } }) => b.reply.title)
    if (i?.action?.sections) return i.action.sections.flatMap((s: { rows: { title: string }[] }) => s.rows.map(r => r.title))
    if (i?.action?.parameters?.display_text) return [i.action.parameters.display_text]
  } catch { /* not ours to worry about */ }
  return []
}

/** Card body without the "[a | b]" suffix client.ts appends for the plain-text log. */
function bodyOf(m: Message): string {
  return (m.body ?? '').replace(/\n\[[^\]]*\]$/, '')
}

export default function WhatsAppPage() {
  const [chats, setChats] = useState<Chat[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const loadChats = useCallback(async () => {
    const res = await fetch('/api/whatsapp/conversations', { cache: 'no-store' })
    if (res.ok) setChats(await res.json())
    setLoading(false)
  }, [])

  const loadThread = useCallback(async (phone: string) => {
    const res = await fetch(`/api/whatsapp/conversations/${encodeURIComponent(phone)}`, { cache: 'no-store' })
    if (res.ok) setThread(await res.json())
  }, [])

  useEffect(() => {
    loadChats()
    const t = setInterval(loadChats, POLL_MS)
    return () => clearInterval(t)
  }, [loadChats])

  useEffect(() => {
    if (!selected) return
    loadThread(selected)
    const t = setInterval(() => loadThread(selected), POLL_MS)
    return () => clearInterval(t)
  }, [selected, loadThread])

  // Keep the view pinned to the newest message as replies arrive.
  useEffect(() => {
    const n = thread?.messages.length ?? 0
    if (n !== lastCount.current) {
      lastCount.current = n
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [thread])

  const visible = chats.filter(c => {
    const q = query.trim().toLowerCase()
    return !q || c.phone.includes(q) || (c.guestName ?? '').toLowerCase().includes(q) || (c.trip?.ref ?? '').toLowerCase().includes(q)
  })

  const current = chats.find(c => c.phone === selected) ?? null

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">WhatsApp</h1>
          <p className="text-sm text-gray-500">Every conversation with the Kanaan number — guests, Anneli and drivers.</p>
        </div>
        <button
          onClick={() => { loadChats(); if (selected) loadThread(selected) }}
          className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* chat list */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="border-b border-gray-100 p-3">
            <div className="flex items-center gap-2 rounded-md bg-gray-100 px-3 py-2">
              <Search size={14} className="text-gray-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search number, name or ref"
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && <p className="p-4 text-sm text-gray-400">Loading…</p>}
            {!loading && visible.length === 0 && <p className="p-4 text-sm text-gray-400">No conversations yet.</p>}
            {visible.map(c => {
              const role = ROLE[c.role ?? 'guest'] ?? ROLE.guest
              const Icon = role.icon
              return (
                <button
                  key={c.phone}
                  onClick={() => setSelected(c.phone)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50',
                    selected === c.phone && 'bg-emerald-50 hover:bg-emerald-50',
                  )}
                >
                  <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', role.tone)}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{c.guestName ?? c.phone}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{whenOf(c.lastAt)}</span>
                    </span>
                    {c.guestName && <span className="block text-[11px] text-gray-400">{c.phone}</span>}
                    <span className="mt-0.5 block truncate text-xs text-gray-500">
                      {c.lastDirection === 'outbound' ? '↩ ' : ''}{(c.lastBody ?? '').split('\n')[0] || '—'}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', role.tone)}>{role.label}</span>
                      {c.trip && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          {c.trip.ref} · {c.trip.status.replace(/_/g, ' ')}
                        </span>
                      )}
                      {c.step && c.step !== 'idle' && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{c.step.replace(/_/g, ' ')}</span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* thread */}
        <section className="flex min-w-0 flex-1 flex-col bg-[#efeae2]">
          {!selected && (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Pick a conversation to read it.</div>
          )}
          {selected && (
            <>
              <header className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{current?.guestName ?? selected}</p>
                  <p className="text-xs text-gray-500">
                    {selected}
                    {thread?.conversation && ` · ${thread.conversation.step.replace(/_/g, ' ')}`}
                  </p>
                </div>
                {thread && thread.trips.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {thread.trips.slice(0, 4).map(t => (
                      <span key={t.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700" title={`${t.placeName ?? ''} · R ${t.fare ?? ''}`}>
                        {t.ref} · {t.status.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                {thread?.messages.length === 0 && <p className="text-center text-sm text-gray-500">No messages with this number.</p>}
                {thread?.messages.map((m, i) => {
                  const prev = thread.messages[i - 1]
                  const newDay = !prev || dayOf(prev.createdAt) !== dayOf(m.createdAt)
                  const out = m.direction === 'outbound'
                  const choices = choicesOf(m)
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div className="my-3 flex justify-center">
                          <span className="rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-gray-500 shadow-sm">{dayOf(m.createdAt)}</span>
                        </div>
                      )}
                      <div className={cn('mb-1.5 flex', out ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm',
                          out ? 'rounded-tr-none bg-[#d9fdd3] text-gray-900' : 'rounded-tl-none bg-white text-gray-900',
                        )}>
                          {m.kind === 'template' && (
                            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                              <FileText size={10} /> {m.templateName}
                            </p>
                          )}
                          {m.kind === 'location' && (
                            <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <MapPin size={10} /> location
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{bodyOf(m) || <span className="text-gray-400">({m.kind})</span>}</p>
                          {choices.length > 0 && (
                            <div className="mt-2 border-t border-black/5 pt-1">
                              {choices.map(c => (
                                <p key={c} className="py-0.5 text-center text-[13px] text-sky-600">{c}</p>
                              ))}
                            </div>
                          )}
                          <p className="mt-1 text-right text-[10px] text-gray-400">{timeOf(m.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {thread && thread.trips.length > 0 && (
                <details className="border-t border-gray-200 bg-white px-5 py-2 text-xs">
                  <summary className="cursor-pointer select-none text-gray-600">Trip timeline</summary>
                  <div className="mt-2 max-h-48 space-y-3 overflow-y-auto">
                    {thread.trips.map(t => (
                      <div key={t.id}>
                        <p className="font-medium text-gray-800">
                          {t.ref} · {t.status.replace(/_/g, ' ')} · {t.direction} · {t.placeName} · R {t.fare}
                          {t.scheduledAt && ` · ${dayOf(t.scheduledAt)} ${timeOf(t.scheduledAt)}`}
                        </p>
                        <ul className="mt-1 space-y-0.5 text-gray-500">
                          {t.events.map(e => (
                            <li key={e.id}>
                              <span className="text-gray-400">{timeOf(e.at)}</span> · {e.actor} · {e.event.replace(/_/g, ' ')}{e.detail ? ` — ${e.detail}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
