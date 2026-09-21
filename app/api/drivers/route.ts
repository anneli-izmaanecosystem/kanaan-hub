import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, drivers } from '@/lib/db'
import { asc } from 'drizzle-orm'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db.select().from(drivers).orderBy(asc(drivers.name))
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const name = String(body.name ?? '').trim()
  const plate = String(body.plate ?? '').trim()
  const phone = normalisePhone(body.phone)

  if (!name)  return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!plate) return NextResponse.json({ error: 'Registration is required' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'A valid WhatsApp number is required' }, { status: 400 })

  try {
    const [row] = await db.insert(drivers).values({
      name, plate, phone,
      vehicle: body.vehicle?.trim() || null,
      active: body.active ?? true,
      onDuty: body.onDuty ?? true,
    }).returning()
    return NextResponse.json(row)
  } catch (err) {
    // phone is unique — two drivers on one number would make inbound messages ambiguous.
    if (String(err).includes('duplicate key')) {
      return NextResponse.json({ error: 'A driver with that number already exists' }, { status: 409 })
    }
    throw err
  }
}

/**
 * Accepts 072 118 4460, 27721184460 or +27721184460 and stores E.164. WhatsApp identifies
 * people by number, so a driver saved in the wrong shape simply never matches.
 */
export function normalisePhone(input: unknown): string | null {
  const raw = String(input ?? '').replace(/[\s()-]/g, '')
  if (!raw) return null

  if (raw.startsWith('+')) return /^\+\d{8,15}$/.test(raw) ? raw : null
  if (raw.startsWith('0')) return `+27${raw.slice(1)}`   // South African local form
  if (raw.startsWith('27')) return `+${raw}`
  return /^\d{8,15}$/.test(raw) ? `+${raw}` : null
}
