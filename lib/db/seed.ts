import { config } from 'dotenv'
config({ path: '.env.local' })
import { inArray } from 'drizzle-orm'
import { db, rooms } from './index'

const roomSeed = [
  // Premium rooms 1–7
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `Room ${i + 1}`, type: 'premium' as const, capacity: 2, ratePp: '350', rateSolo: '450',
  })),
  // Budget rooms 8–14
  ...Array.from({ length: 7 }, (_, i) => ({
    name: `Room ${i + 8}`, type: 'budget' as const, capacity: 2, ratePp: '250', rateSolo: '350',
  })),
  // Dorm room 15
  { name: 'Room 15 (Dorm)', type: 'dorm' as const, capacity: 6, ratePp: '200', rateSolo: null },
  // Premium rooms 16–18
  ...Array.from({ length: 3 }, (_, i) => ({
    name: `Room ${i + 16}`, type: 'premium' as const, capacity: 2, ratePp: '350', rateSolo: '450',
  })),
  // Camping spots A–C
  ...['A', 'B', 'C'].map(letter => ({
    name: `Camping ${letter}`, type: 'camping' as const, capacity: 6, ratePp: '250', rateSolo: null,
  })),
  // Additional rooms 19–21
  { name: 'Room 19', type: 'premium' as const, capacity: 2, ratePp: '350', rateSolo: '450' },
  { name: 'Room 20', type: 'premium' as const, capacity: 2, ratePp: '350', rateSolo: '450' },
  { name: 'Room 21', type: 'budget' as const, capacity: 2, ratePp: '250', rateSolo: '350' },
  // Combined room
  { name: 'Room 10/13', type: 'premium' as const, capacity: 4, ratePp: '350', rateSolo: '450' },
  // Backpackers — Dorm A (3 beds)
  ...Array.from({ length: 3 }, (_, i) => ({
    name: `Dorm A - Bed ${i + 1}`, type: 'dorm' as const, capacity: 1, ratePp: '200', rateSolo: null,
  })),
  // Backpackers — Dorm B (5 beds)
  ...Array.from({ length: 5 }, (_, i) => ({
    name: `Dorm B - Bed ${i + 1}`, type: 'dorm' as const, capacity: 1, ratePp: '200', rateSolo: null,
  })),
  // Camp sites 1–5
  ...Array.from({ length: 5 }, (_, i) => ({
    name: `Camp Site ${i + 1}`, type: 'camping' as const, capacity: 6, ratePp: '250', rateSolo: null,
  })),
]

async function seed() {
  console.log('Seeding rooms…')
  await db.insert(rooms).values(roomSeed).onConflictDoNothing()

  // Deactivate old placeholder dorm/camping rooms superseded by the new ones
  await db.update(rooms).set({ active: false }).where(
    inArray(rooms.name, ['Room 15 (Dorm)', 'Camping A', 'Camping B', 'Camping C'])
  )

  console.log(`Inserted/updated ${roomSeed.length} rooms.`)
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
