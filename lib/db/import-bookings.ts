import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'fs'
import { db, bookings, rooms } from './index'

const CSV_PATH = 'C:\\Users\\annel\\izmaan-ecosystem\\Kanaan Guest Farm\\New Booking Sheet - Bookings (2).csv'

function parseMoney(val: string): string {
  if (!val) return '0'
  const n = parseFloat(val.replace(/[R\s,]/g, '').replace(/^-/, '')) || 0
  return String(n)
}

function normalizeRoomName(name: string): string {
  const n = name.trim()
  if (n === 'Camping' || n === 'Camp') return 'Camping A'
  if (n === 'Room 6-New') return 'Room 6'
  if (n === 'Room 3-New') return 'Room 3'
  if (n === 'Room 15') return 'Room 15 (Dorm)'
  return n
}

function normalizeStatus(s: string): 'confirmed' | 'pending' | 'cancelled' | 'checked_in' | 'checked_out' | 'fully_paid' | 'partially_paid' | 'quote_sent' | 'unpaid' {
  switch ((s ?? '').toLowerCase().trim()) {
    case 'fully paid':    return 'fully_paid'
    case 'partially paid': return 'partially_paid'
    case 'quote sent':    return 'quote_sent'
    case 'unpaid':        return 'unpaid'
    default:              return 'confirmed'
  }
}

function parseDate(val: string): string | null {
  if (!val?.trim()) return null
  const d = new Date(val.trim())
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter(l => l.trim())
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    // Handle commas inside quoted fields
    const fields: string[] = []
    let cur = ''; let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    fields.push(cur.trim())
    return Object.fromEntries(headers.map((h, i) => [h, (fields[i] ?? '').replace(/^"|"$/g, '')]))
  })
}

async function main() {
  const content = readFileSync(CSV_PATH, 'utf-8')
  const rows = parseCSV(content)
  console.log(`Parsed ${rows.length} rows`)

  // Build room name → id map
  const allRooms = await db.select({ id: rooms.id, name: rooms.name }).from(rooms)
  const roomMap = new Map(allRooms.map(r => [r.name, r.id]))

  let inserted = 0; let skipped = 0
  for (const row of rows) {
    const guestName = row['Guest']?.trim()
    const roomName  = normalizeRoomName(row['Room'] ?? '')
    const checkIn   = parseDate(row['Check-in'])
    const checkOut  = parseDate(row['Check-out'])
    const payDate   = parseDate(row['PayDate'])

    if (!guestName || !checkIn || !checkOut) { skipped++; continue }

    const roomId = roomMap.get(roomName)
    if (!roomId) { console.warn(`  Unknown room: "${row['Room']}" — skipping`); skipped++; continue }

    const total   = parseMoney(row['Total'])
    const deposit = parseMoney(row['Deposit'])
    const balance = parseMoney(row['Balance Due'])
    const nights  = parseInt(row['Nights']) || Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)
    const adults  = parseInt(row['Pax']) || 1

    try {
      await db.insert(bookings).values({
        roomId,
        guestName,
        contact:       guestName,
        checkIn,
        checkOut,
        adults,
        children:      0,
        nights,
        totalAmount:   total,
        depositPaid:   deposit,
        balanceDue:    balance,
        status:        normalizeStatus(row['Status']),
        source:        row['Source']?.trim() || null,
        paymentMethod: row['Payment']?.trim() || null,
        invoiceNumber: row['Invoice']?.trim() || null,
        payDate:       payDate,
        notes:         row['Notes']?.trim() || null,
      })
      inserted++
    } catch (err: any) {
      console.warn(`  Skip "${guestName}" ${checkIn}: ${err.message?.slice(0, 80)}`)
      skipped++
    }
  }

  console.log(`Done — inserted: ${inserted}, skipped: ${skipped}`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
