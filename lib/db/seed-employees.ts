import { config } from 'dotenv'
config({ path: '.env.local' })
import { db } from './index'
import * as schema from './schema'

async function seed() {
  console.log('Seeding Kanaan Hub payroll...')

  // ── Entities ──────────────────────────────────────────────────────────────
  const entityRows = await db.insert(schema.entities).values([
    {
      name: 'Kanaan Guest Farm', tradingName: 'Kanaan Guest Farm',
      uifRef: '2880303/3', entityType: 'kanaan' as const,
      address: 'Kanaan Guest Farm, Limpopo',
    },
    { name: 'Plant Hire', tradingName: 'Kanaan Plant Hire', entityType: 'plant_hire' as const },
    { name: 'Investment Project', tradingName: 'Investment Project', entityType: 'investment_project' as const },
  ]).returning()

  const kanaan    = entityRows[0]
  const plantHire = entityRows[1]
  const invProj   = entityRows[2]
  console.log('Entities:', entityRows.map(e => e.name).join(', '))

  // ── Workers ───────────────────────────────────────────────────────────────
  const workerRows = await db.insert(schema.workers).values([
    // Kanaan — housekeeping (hourly 6.5h/day @ NMW R30.23)
    { entityId: kanaan.id, name: 'Flora Masikhanyile',  idNumber: '7103100465082', workerType: 'employee' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '6.5',  department: 'Housekeeping', position: 'Housekeeper' },
    { entityId: kanaan.id, name: 'Lilian Malumane',     idNumber: '6912030766083', workerType: 'employee' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '6.5',  department: 'Housekeeping', position: 'Housekeeper' },
    { entityId: kanaan.id, name: 'Judith Nozipho',      idNumber: '8105090257089', workerType: 'employee' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '6.5',  department: 'Housekeeping', position: 'Housekeeper' },
    { entityId: kanaan.id, name: 'Mathabo Makhubela',   idNumber: '8508060510082', workerType: 'employee' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '6.5',  department: 'Housekeeping', position: 'Housekeeper' },
    // Kanaan — general worker (daily rate)
    { entityId: kanaan.id, name: 'Joseph Nyathi',       idNumber: '9403065801083', workerType: 'employee' as const, payStructure: 'daily' as const,  dailyRate: '250',                            department: 'Farm',         position: 'General Worker' },
    // Plant Hire — TLB driver (floor salary)
    { entityId: plantHire.id, name: 'Alpheus Mlambo',   idNumber: '6306095252081', workerType: 'employee' as const, payStructure: 'floor' as const,  floorSalary: '8000', saturdayRate: '300',    department: 'Plant Hire',   position: 'TLB Driver / Operator', notes: 'Monitor PAYE threshold. Off-site client work tracked in Fuel Recon module (TBD).' },
    // Investment Project — contractors (informal)
    { entityId: invProj.id,   name: 'Zweli',            workerType: 'contractor' as const, payStructure: 'daily' as const,  dailyRate: '250', department: 'Farm' },
    { entityId: invProj.id,   name: 'Lucas',            workerType: 'contractor' as const, payStructure: 'daily' as const,  dailyRate: '300', department: 'Farm' },
    { entityId: invProj.id,   name: 'Walter',           workerType: 'contractor' as const, payStructure: 'daily' as const,  dailyRate: '320', department: 'Farm' },
    { entityId: invProj.id,   name: 'Patrick',          workerType: 'contractor' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '8', department: 'Farm' },
    { entityId: invProj.id,   name: 'Bheki',            workerType: 'contractor' as const, payStructure: 'hourly' as const, hourlyRate: '30.23', stdHoursPerDay: '8', department: 'Farm' },
  ]).returning()

  const byName = Object.fromEntries(workerRows.map(w => [w.name, w]))
  console.log('Workers:', workerRows.map(w => w.name).join(', '))

  // ── WhatsApp aliases ──────────────────────────────────────────────────────
  await db.insert(schema.workerAliases).values([
    { workerId: byName['Flora Masikhanyile'].id,  alias: 'Florah' },
    { workerId: byName['Flora Masikhanyile'].id,  alias: 'Flora' },
    { workerId: byName['Alpheus Mlambo'].id,      alias: 'Alfos' },
    { workerId: byName['Alpheus Mlambo'].id,      alias: 'Alpheus' },
    { workerId: byName['Lucas'].id,               alias: 'Lukas' },
    { workerId: byName['Zweli'].id,               alias: 'Zwele' },
    { workerId: byName['Zweli'].id,               alias: 'Zweli' },
    { workerId: byName['Patrick'].id,             alias: 'Patric' },
    { workerId: byName['Patrick'].id,             alias: 'Patrick' },
    { workerId: byName['Joseph Nyathi'].id,       alias: 'Joseph' },
    { workerId: byName['Bheki'].id,               alias: 'Bheki' },
    { workerId: byName['Walter'].id,              alias: 'Walter' },
    { workerId: byName['Mathabo Makhubela'].id,   alias: 'Mathabo' },
    { workerId: byName['Judith Nozipho'].id,      alias: 'Judith' },
    { workerId: byName['Lilian Malumane'].id,     alias: 'Lilian' },
  ])
  console.log('Aliases seeded')

  // ── SA Public Holidays 2025–2026 ──────────────────────────────────────────
  await db.insert(schema.publicHolidays).values([
    { date: '2025-01-01', name: "New Year's Day",               year: 2025 },
    { date: '2025-03-21', name: 'Human Rights Day',             year: 2025 },
    { date: '2025-04-18', name: 'Good Friday',                  year: 2025 },
    { date: '2025-04-21', name: 'Family Day',                   year: 2025 },
    { date: '2025-04-27', name: 'Freedom Day',                  year: 2025 },
    { date: '2025-04-28', name: 'Freedom Day (observed)',       year: 2025 },
    { date: '2025-05-01', name: "Workers' Day",                 year: 2025 },
    { date: '2025-06-16', name: 'Youth Day',                    year: 2025 },
    { date: '2025-08-09', name: "National Women's Day",         year: 2025 },
    { date: '2025-09-24', name: 'Heritage Day',                 year: 2025 },
    { date: '2025-12-16', name: 'Day of Reconciliation',        year: 2025 },
    { date: '2025-12-25', name: 'Christmas Day',                year: 2025 },
    { date: '2025-12-26', name: 'Day of Goodwill',              year: 2025 },
    { date: '2026-01-01', name: "New Year's Day",               year: 2026 },
    { date: '2026-03-21', name: 'Human Rights Day',             year: 2026 },
    { date: '2026-04-03', name: 'Good Friday',                  year: 2026 },
    { date: '2026-04-06', name: 'Family Day',                   year: 2026 },
    { date: '2026-04-27', name: 'Freedom Day',                  year: 2026 },
    { date: '2026-05-01', name: "Workers' Day",                 year: 2026 },
    { date: '2026-06-16', name: 'Youth Day',                    year: 2026 },
    { date: '2026-08-10', name: "National Women's Day (observed)", year: 2026 },
    { date: '2026-09-24', name: 'Heritage Day',                 year: 2026 },
    { date: '2026-12-16', name: 'Day of Reconciliation',        year: 2026 },
    { date: '2026-12-25', name: 'Christmas Day',                year: 2026 },
    { date: '2026-12-26', name: 'Day of Goodwill',              year: 2026 },
  ])
  console.log('Public holidays seeded (2025–2026)')

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
