// Idempotent upsert of the real Kanaan Guest Farm room pricelist (July 2026 rate card).
// Safe to re-run — matches existing rooms by name and updates their pricing/category/bed
// config in place; rooms not listed here are left untouched.
//
// Run with: npm run db:seed:pricelist

import { config } from 'dotenv'
config({ path: '.env.local' })
import { eq, and } from 'drizzle-orm'
import { db, rooms, roomCombos, roomComboMembers } from './index'

const PREMIUM = 'Premium (Self Catering)'
const BACKPACKERS = 'Backpackers'
const TWIN = 'Twin Rooms with Shared Kitchen'

const roomSeed = [
  { name: 'Room 1',  type: 'premium' as const, capacity: 4, ratePp: '1200', rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double, 2 twin' },
  { name: 'Room 3',  type: 'premium' as const, capacity: 2, ratePp: '600',  rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '2 twin' },
  { name: 'Room 6',  type: 'premium' as const, capacity: 3, ratePp: '750',  rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '3 twin' },
  { name: 'Room 4',  type: 'premium' as const, capacity: 4, ratePp: '1150', rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double, 2 twin' },
  { name: 'Room 5',  type: 'premium' as const, capacity: 4, ratePp: '1200', rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double, 2 twin' },
  { name: 'Room 9',  type: 'premium' as const, capacity: 6, ratePp: '1800', rateSolo: null,   pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '2 double, 2 twin' },
  { name: 'Room 10', type: 'premium' as const, capacity: 2, ratePp: '650',  rateSolo: '450',  pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double bed' },
  { name: 'Room 11', type: 'premium' as const, capacity: 2, ratePp: '650',  rateSolo: '450',  pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double bed' },
  { name: 'Room 12', type: 'premium' as const, capacity: 2, ratePp: '650',  rateSolo: '450',  pricingMode: 'flat' as const,    category: PREMIUM,     bedConfig: '1 double bed' },

  { name: 'Room 8',  type: 'dorm' as const,    capacity: 8, ratePp: '200',  rateSolo: null,   pricingMode: 'per_pax' as const, category: BACKPACKERS, bedConfig: null },

  { name: 'Room 14', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 16', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 17', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 18', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 19', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 20', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '2 twin' },
  { name: 'Room 15', type: 'budget' as const,  capacity: 2, ratePp: '500',  rateSolo: '350',  pricingMode: 'flat' as const,    category: TWIN,        bedConfig: '1 double bed' },
]

const comboSeed = [
  { name: 'Room 3 + 6 Combo', memberNames: ['Room 3', 'Room 6'], capacity: 5, rate: '250', pricingMode: 'per_pax' as const },
]

async function upsertRooms() {
  for (const r of roomSeed) {
    await db.insert(rooms).values({ ...r, active: true }).onConflictDoUpdate({
      target: rooms.name,
      set: {
        type: r.type, capacity: r.capacity, ratePp: r.ratePp, rateSolo: r.rateSolo,
        pricingMode: r.pricingMode, category: r.category, bedConfig: r.bedConfig, active: true,
      },
    })
  }
  console.log(`Upserted ${roomSeed.length} rooms.`)
}

async function upsertCombos() {
  for (const c of comboSeed) {
    const memberRooms = await db.select().from(rooms)
    const memberIds = c.memberNames.map(name => {
      const room = memberRooms.find(r => r.name === name)
      if (!room) throw new Error(`Combo "${c.name}" references unknown room "${name}" — run upsertRooms first`)
      return room.id
    })

    const [existing] = await db.select().from(roomCombos).where(eq(roomCombos.name, c.name))
    const combo = existing
      ? (await db.update(roomCombos).set({
          capacity: c.capacity, rate: c.rate, pricingMode: c.pricingMode, active: true,
        }).where(eq(roomCombos.id, existing.id)).returning())[0]
      : (await db.insert(roomCombos).values({
          name: c.name, capacity: c.capacity, rate: c.rate, pricingMode: c.pricingMode,
        }).returning())[0]

    await db.delete(roomComboMembers).where(eq(roomComboMembers.comboId, combo.id))
    await db.insert(roomComboMembers).values(memberIds.map(roomId => ({ comboId: combo.id, roomId })))
  }
  console.log(`Upserted ${comboSeed.length} room combo(s).`)
}

async function main() {
  console.log('Applying real room pricelist…')
  await upsertRooms()
  await upsertCombos()
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
