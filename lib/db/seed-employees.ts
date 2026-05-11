import { config } from 'dotenv'
config({ path: '.env.local' })
import { db, employees } from './index'

const staff = [
  { name: 'Judith Nozipho',      idNumber: '8105090257089', department: 'Housekeeping',    position: null, payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-08-01' },
  { name: 'Florah Masikhanyile', idNumber: '7103100465082', department: 'Housekeeping',    position: null, payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-08-01' },
  { name: 'Mathabo Makhubela',   idNumber: '8508060510082', department: 'Housekeeping',    position: null, payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-08-01' },
  { name: 'Lilian Malumane',     idNumber: '6912030766083', department: 'Housekeeping',    position: null, payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-08-01' },
  { name: 'Alpheus Mlambo',      idNumber: null,             department: 'Driver',          position: 'Driver', payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-02-02' },
  { name: 'Joseph Nyathi',       idNumber: '9403065801083', department: 'General Workers', position: null, payType: 'hourly' as const, hoursType: 'variable' as const, hourlyRate: '30.23', startDate: '2025-08-01' },
]

async function seed() {
  console.log('Seeding employees…')
  for (const emp of staff) {
    await db.insert(employees).values(emp).onConflictDoNothing()
  }
  console.log(`Inserted ${staff.length} employees.`)
  process.exit(0)
}

seed().catch(err => { console.error(err); process.exit(1) })
