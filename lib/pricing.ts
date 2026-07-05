// Shared pricing logic for rooms, room combos, and multi-room bookings.
// Used by both the pricelist page (for reference) and booking forms (for live totals).

export type PriceRoom = {
  id: number
  ratePp: string
  rateSolo: string | null
  pricingMode: 'flat' | 'per_pax'
  capacity: number
}

export type PriceCombo = {
  id: number
  roomIds: number[]
  rate: string
  pricingMode: 'flat' | 'per_pax'
}

function roomNightlyRate(room: PriceRoom, adults: number): number {
  const pax = Math.max(1, adults)
  if (room.pricingMode === 'per_pax') return pax * parseFloat(room.ratePp)
  if (pax <= 1 && room.rateSolo) return parseFloat(room.rateSolo)
  return parseFloat(room.ratePp)
}

function comboNightlyRate(combo: PriceCombo, adults: number): number {
  const pax = Math.max(1, adults)
  return combo.pricingMode === 'per_pax' ? pax * parseFloat(combo.rate) : parseFloat(combo.rate)
}

// A combo applies once ALL of its member rooms are among the selected rooms — those rooms
// are then priced as one unit (e.g. Room 3 + Room 6 booked together become a 5-sleeper @ R250pp)
// instead of being summed individually. Any selected rooms left over are priced on their own.
export function nightlyRateForRooms(selectedRoomIds: number[], rooms: PriceRoom[], combos: PriceCombo[], adults: number): number {
  const remaining = new Set(selectedRoomIds)
  let total = 0

  const applicableCombos = [...combos]
    .filter(c => c.roomIds.length > 0 && c.roomIds.every(id => remaining.has(id)))
    .sort((a, b) => b.roomIds.length - a.roomIds.length)

  for (const combo of applicableCombos) {
    if (!combo.roomIds.every(id => remaining.has(id))) continue // already consumed by a bigger combo
    total += comboNightlyRate(combo, adults)
    combo.roomIds.forEach(id => remaining.delete(id))
  }

  for (const id of remaining) {
    const room = rooms.find(r => r.id === id)
    if (room) total += roomNightlyRate(room, adults)
  }

  return total
}

export function totalForBooking(
  selectedRoomIds: number[],
  rooms: PriceRoom[],
  combos: PriceCombo[],
  adults: number,
  nights: number,
): number {
  return nightlyRateForRooms(selectedRoomIds, rooms, combos, adults) * Math.max(0, nights)
}

// Soft guidance only — front desk may still override for specific guests.
export function minOccupancy(capacity: number): number {
  return Math.max(1, capacity - 1)
}
