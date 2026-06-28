import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, fuelLogs } from '@/lib/db'
import { desc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const rows = await db.select().from(fuelLogs).orderBy(desc(fuelLogs.createdAt)).limit(50)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { vehicle, logDate, openReading, closeReading, litres, purpose, notes, createdBy } = body

    if (!vehicle) return NextResponse.json({ error: 'Vehicle is required' }, { status: 400 })

    // Calculate litres from open/close if not provided directly
    let resolvedLitres = litres
    if (!resolvedLitres && openReading != null && closeReading != null) {
      resolvedLitres = parseFloat(closeReading) - parseFloat(openReading)
    }
    if (!resolvedLitres || resolvedLitres <= 0)
      return NextResponse.json({ error: 'Litres or open/close readings required' }, { status: 400 })

    const today = new Date().toISOString().split('T')[0]

    const [row] = await db.insert(fuelLogs).values({
      vehicle,
      logDate:      logDate ?? today,
      openReading:  openReading != null ? String(openReading) : null,
      closeReading: closeReading != null ? String(closeReading) : null,
      litres:       String(resolvedLitres),
      purpose:      purpose ?? null,
      notes:        notes ?? null,
      createdBy:    createdBy ?? null,
    }).returning()

    return NextResponse.json(row, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/fuel-log POST]', err)
    return NextResponse.json({ error: 'Failed to save fuel log' }, { status: 500 })
  }
}
