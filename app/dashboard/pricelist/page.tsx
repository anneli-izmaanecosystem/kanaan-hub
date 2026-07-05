'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { CalendarDays, Plus, Trash2, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { minOccupancy } from '@/lib/pricing'

type Room = {
  id: number; name: string; type: string; capacity: number
  ratePp: string; rateSolo: string | null; pricingMode: 'flat' | 'per_pax'
  category: string | null; bedConfig: string | null; active: boolean
}
type Combo = {
  id: number; name: string; capacity: number; rate: string
  pricingMode: 'flat' | 'per_pax'; active: boolean; roomIds: number[]
}

const CATEGORY_ORDER = ['Premium (Self Catering)', 'Backpackers', 'Twin Rooms with Shared Kitchen']

function groupByCategory(rooms: Room[]): [string, Room[]][] {
  const map = new Map<string, Room[]>()
  for (const r of rooms) {
    const cat = r.category ?? 'Other'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(r)
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return keys.map(k => [k, map.get(k)!.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))])
}

const TYPE_OPTIONS = [
  { value: 'premium', label: 'Premium' },
  { value: 'budget',  label: 'Budget / Twin' },
  { value: 'dorm',    label: 'Dorm / Backpackers' },
  { value: 'camping', label: 'Camping' },
]

export default function PricelistPage() {
  const [rooms, setRooms]     = useState<Room[]>([])
  const [combos, setCombos]   = useState<Combo[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [savedId, setSavedId]   = useState<number | null>(null)
  const [addingRoom, setAddingRoom] = useState(false)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [roomForm, setRoomForm] = useState({
    name: '', type: 'premium', category: '', bedConfig: '',
    capacity: '2', pricingMode: 'flat' as 'flat' | 'per_pax', ratePp: '', rateSolo: '',
  })

  useEffect(() => { load() }, [])

  function load() {
    setLoading(true)
    Promise.all([
      fetch('/api/rooms?all=1', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/room-combos', { cache: 'no-store' }).then(r => r.json()),
    ]).then(([r, c]) => {
      setRooms(Array.isArray(r) ? r : [])
      setCombos(Array.isArray(c) ? c : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  function setRoomField(id: number, field: keyof Room, value: any) {
    setRooms(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function saveRoom(id: number, patch: Partial<Room>) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/rooms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        setSavedId(id)
        setTimeout(() => setSavedId(cur => cur === id ? null : cur), 1200)
      }
    } finally {
      setSavingId(null)
    }
  }

  async function saveCombo(id: number, patch: Partial<Combo>) {
    setSavingId(id)
    try {
      await fetch(`/api/room-combos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setSavedId(id)
      setTimeout(() => setSavedId(cur => cur === id ? null : cur), 1200)
    } finally {
      setSavingId(null)
    }
  }

  const inp = 'w-full rounded-md border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent'
  const formInp = 'w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm'

  async function createRoom() {
    if (!roomForm.name.trim() || !roomForm.ratePp) return
    setCreatingRoom(true)
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...roomForm, category: roomForm.category || null, bedConfig: roomForm.bedConfig || null, rateSolo: roomForm.rateSolo || null }),
      })
      if (res.ok) {
        setRoomForm({ name: '', type: 'premium', category: '', bedConfig: '', capacity: '2', pricingMode: 'flat', ratePp: '', rateSolo: '' })
        setAddingRoom(false)
        load()
      }
    } finally {
      setCreatingRoom(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold text-gray-900">Pricelist</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setAddingRoom(v => !v)}
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <Plus size={16} /> Add Room
          </button>
          <Link href="/dashboard/bookings"
            className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            <CalendarDays size={16} /> Bookings
          </Link>
        </div>
      </div>
      <p className="text-sm text-gray-400 mb-6">Rates apply per night. Edits save automatically.</p>

      {addingRoom && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 mb-8 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <input className={formInp} placeholder="Room name (e.g. Room 8)" value={roomForm.name}
              onChange={e => setRoomForm(f => ({ ...f, name: e.target.value }))} />
            <input className={formInp} placeholder="Category (e.g. Backpackers)" value={roomForm.category}
              onChange={e => setRoomForm(f => ({ ...f, category: e.target.value }))} />
            <input className={formInp} placeholder="Bed config" value={roomForm.bedConfig}
              onChange={e => setRoomForm(f => ({ ...f, bedConfig: e.target.value }))} />
            <select className={formInp} value={roomForm.type} onChange={e => setRoomForm(f => ({ ...f, type: e.target.value }))}>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <input type="number" min={1} className={formInp} placeholder="Capacity" value={roomForm.capacity}
              onChange={e => setRoomForm(f => ({ ...f, capacity: e.target.value }))} />
            <select className={formInp} value={roomForm.pricingMode} onChange={e => setRoomForm(f => ({ ...f, pricingMode: e.target.value as any }))}>
              <option value="flat">Flat / room</option>
              <option value="per_pax">Per person</option>
            </select>
            <input type="number" step="0.01" className={formInp} placeholder="Full rate (R)" value={roomForm.ratePp}
              onChange={e => setRoomForm(f => ({ ...f, ratePp: e.target.value }))} />
            <input type="number" step="0.01" className={formInp} placeholder="Solo rate (R, optional)" value={roomForm.rateSolo}
              onChange={e => setRoomForm(f => ({ ...f, rateSolo: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={createRoom} disabled={creatingRoom} className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {creatingRoom ? 'Saving…' : 'Save Room'}
            </button>
            <button onClick={() => setAddingRoom(false)} className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {groupByCategory(rooms).map(([category, roomsInCat]) => (
        <div key={category} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">{category}</h2>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Room</th>
                  <th className="px-3 py-2 text-left font-medium">Beds</th>
                  <th className="px-3 py-2 text-center font-medium">Capacity</th>
                  <th className="px-3 py-2 text-left font-medium">Pricing</th>
                  <th className="px-3 py-2 text-right font-medium">Full Rate (R)</th>
                  <th className="px-3 py-2 text-right font-medium">Solo Rate (R)</th>
                  <th className="px-3 py-2 text-center font-medium">Active</th>
                  <th className="px-3 py-2 w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {roomsInCat.map(room => (
                  <tr key={room.id} className={cn(!room.active && 'opacity-50')}>
                    <td className="px-4 py-1.5 font-medium text-gray-900 whitespace-nowrap">{room.name}</td>
                    <td className="px-3 py-1.5">
                      <input
                        className={inp}
                        value={room.bedConfig ?? ''}
                        placeholder="e.g. 1 double, 2 twin"
                        onChange={e => setRoomField(room.id, 'bedConfig', e.target.value)}
                        onBlur={e => saveRoom(room.id, { bedConfig: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number" min={1}
                        className={cn(inp, 'text-center')}
                        value={room.capacity}
                        onChange={e => setRoomField(room.id, 'capacity', parseInt(e.target.value) || 1)}
                        onBlur={e => saveRoom(room.id, { capacity: parseInt(e.target.value) || 1 })}
                      />
                      <div className="text-[10px] text-gray-400 text-center mt-0.5">min {minOccupancy(room.capacity)}pax*</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        className={inp}
                        value={room.pricingMode}
                        onChange={e => { setRoomField(room.id, 'pricingMode', e.target.value); saveRoom(room.id, { pricingMode: e.target.value as any }) }}
                      >
                        <option value="flat">Flat / room</option>
                        <option value="per_pax">Per person</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number" step="0.01"
                        className={cn(inp, 'text-right')}
                        value={room.ratePp}
                        onChange={e => setRoomField(room.id, 'ratePp', e.target.value)}
                        onBlur={e => saveRoom(room.id, { ratePp: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number" step="0.01"
                        className={cn(inp, 'text-right')}
                        placeholder="—"
                        value={room.rateSolo ?? ''}
                        onChange={e => setRoomField(room.id, 'rateSolo', e.target.value)}
                        onBlur={e => saveRoom(room.id, { rateSolo: e.target.value })}
                        disabled={room.pricingMode === 'per_pax'}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={room.active}
                        onChange={e => { setRoomField(room.id, 'active', e.target.checked); saveRoom(room.id, { active: e.target.checked }) }}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {savingId === room.id && <Loader2 size={13} className="animate-spin text-gray-300" />}
                      {savedId === room.id && <Check size={13} className="text-green-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="text-xs text-gray-400 mb-6">* Guidance only — don't book below capacity&nbsp;−&nbsp;1 pax unless the front desk decides otherwise.</p>

      <RoomCombos combos={combos} rooms={rooms} onChange={setCombos} onSave={saveCombo} savingId={savingId} savedId={savedId} reload={load} />
    </div>
  )
}

function RoomCombos({ combos, rooms, onChange, onSave, savingId, savedId, reload }: {
  combos: Combo[]; rooms: Room[]
  onChange: (fn: (prev: Combo[]) => Combo[]) => void
  onSave: (id: number, patch: Partial<Combo>) => Promise<void>
  savingId: number | null; savedId: number | null
  reload: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', rate: '', pricingMode: 'per_pax' as 'flat' | 'per_pax', roomIds: [] as number[] })
  const [creating, setCreating] = useState(false)

  function roomName(id: number) { return rooms.find(r => r.id === id)?.name ?? `#${id}` }

  function toggleRoom(id: number) {
    setForm(f => ({ ...f, roomIds: f.roomIds.includes(id) ? f.roomIds.filter(r => r !== id) : [...f.roomIds, id] }))
  }

  async function createCombo() {
    if (!form.name.trim() || !form.rate || form.roomIds.length < 2) return
    setCreating(true)
    try {
      const res = await fetch('/api/room-combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, capacity: form.roomIds.reduce((s, id) => s + (rooms.find(r => r.id === id)?.capacity ?? 0), 1) }),
      })
      if (res.ok) {
        setForm({ name: '', rate: '', pricingMode: 'per_pax', roomIds: [] })
        setAdding(false)
        reload()
      }
    } finally {
      setCreating(false)
    }
  }

  async function removeCombo(id: number) {
    if (!confirm('Remove this room combo?')) return
    await fetch(`/api/room-combos/${id}`, { method: 'DELETE' })
    onChange(prev => prev.filter(c => c.id !== id))
  }

  const inp = 'w-full rounded-md border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent'

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-700">Joined-Room Combos</h2>
        <button onClick={() => setAdding(v => !v)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">
          <Plus size={14} /> Add Combo
        </button>
      </div>

      {adding && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 mb-3 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input className={cn(inp, 'border-gray-200 bg-white')} placeholder="Combo name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <select className={cn(inp, 'border-gray-200 bg-white')} value={form.pricingMode}
              onChange={e => setForm(f => ({ ...f, pricingMode: e.target.value as any }))}>
              <option value="per_pax">Per person</option>
              <option value="flat">Flat / room</option>
            </select>
            <input type="number" step="0.01" className={cn(inp, 'border-gray-200 bg-white')} placeholder="Rate (R)" value={form.rate}
              onChange={e => setForm(f => ({ ...f, rate: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-2">
            {rooms.filter(r => r.active).map(r => (
              <button key={r.id} type="button" onClick={() => toggleRoom(r.id)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs border',
                  form.roomIds.includes(r.id) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200'
                )}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={createCombo} disabled={creating} className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm text-white disabled:opacity-50">
              {creating ? 'Saving…' : 'Save Combo'}
            </button>
            <button onClick={() => setAdding(false)} className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {combos.length === 0 && !adding ? (
        <p className="text-sm text-gray-400">No room combos yet.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Combo</th>
                <th className="px-3 py-2 text-left font-medium">Rooms</th>
                <th className="px-3 py-2 text-center font-medium">Capacity</th>
                <th className="px-3 py-2 text-left font-medium">Pricing</th>
                <th className="px-3 py-2 text-right font-medium">Rate (R)</th>
                <th className="px-3 py-2 w-6" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {combos.map(combo => (
                <tr key={combo.id}>
                  <td className="px-4 py-1.5 font-medium text-gray-900">{combo.name}</td>
                  <td className="px-3 py-1.5 text-gray-600">{combo.roomIds.map(roomName).join(' + ')}</td>
                  <td className="px-3 py-1.5 text-center text-gray-600">{combo.capacity}</td>
                  <td className="px-3 py-1.5 text-gray-600">{combo.pricingMode === 'per_pax' ? 'Per person' : 'Flat / room'}</td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number" step="0.01"
                      className={cn(inp, 'text-right')}
                      defaultValue={combo.rate}
                      onBlur={e => onSave(combo.id, { rate: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => removeCombo(combo.id)} className="text-gray-300 hover:text-red-500">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
