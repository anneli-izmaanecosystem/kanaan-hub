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
]

async function seed() {
  console.log('Seeding rooms…')
  await db.insert(rooms).values(roomSeed).onConflictDoNothing()
  console.log(`Inserted ${roomSeed.length} rooms.`)
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
