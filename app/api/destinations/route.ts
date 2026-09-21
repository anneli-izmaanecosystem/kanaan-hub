import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, destinations } from '@/lib/db'
import { asc } from 'drizzle-orm'
import { distanceFromFarm } from '@/lib/whatsapp/places'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db.select().from(destinations).orderBy(asc(destinations.name))

  // Distance is derived from the coordinates, so it is computed on read rather than
  // stored — moving the farm pin then corrects every destination at once.
  return NextResponse.json(rows.map(d => ({
    ...d,
    ...distanceFromFarm(Number(d.lat), Number(d.lng)),
  })))
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const name = String(body.name ?? '').trim()
  const lat = Number(body.lat)
  const lng = Number(body.lng)

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json({ error: 'Latitude must be between -90 and 90' }, { status: 400 })
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json({ error: 'Longitude must be between -180 and 180' }, { status: 400 })
  }

  try {
    const [row] = await db.insert(destinations).values({
      name,
      aliases: cleanAliases(body.aliases),
      lat: String(lat),
      lng: String(lng),
      fixedFare: body.fixedFare ? String(body.fixedFare) : null,
      active: body.active ?? true,
    }).returning()
    return NextResponse.json({ ...row, ...distanceFromFarm(lat, lng) })
  } catch (err) {
    if (String(err).includes('duplicate key')) {
      return NextResponse.json({ error: 'A destination with that name already exists' }, { status: 409 })
    }
    throw err
  }
}

/** Lowercased and de-duplicated: the matcher compares against lowercase guest text. */
export function cleanAliases(input: unknown): string | null {
  const list = String(input ?? '')
    .split(',')
    .map(a => a.trim().toLowerCase())
    .filter(Boolean)
  return list.length ? [...new Set(list)].join(', ') : null
}
