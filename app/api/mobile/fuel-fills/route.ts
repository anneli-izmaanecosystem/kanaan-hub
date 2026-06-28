import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, fuelFills, fuelPurchases } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'

// GET /api/mobile/fuel-fills — list recent fills (drafts first, then finals)
export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select()
    .from(fuelFills)
    .orderBy(desc(fuelFills.fillDate), desc(fuelFills.createdAt))
    .limit(100)

  return NextResponse.json(rows)
}

// POST /api/mobile/fuel-fills — capture a new fill (saves as draft)
export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      fillDate, driverId, driverName, vehicle,
      openReading, closeReading, litres: rawLitres,
      isEstimated, photoUrl, notes, createdBy,
    } = body

    if (!driverName) return NextResponse.json({ error: 'driverName required' }, { status: 400 })
    if (!vehicle)    return NextResponse.json({ error: 'vehicle required' },    { status: 400 })

    // Resolve litres from readings if not supplied directly
    let litres = rawLitres
    if (!litres && openReading != null && closeReading != null) {
      litres = parseFloat(closeReading) - parseFloat(openReading)
    }
    if (!litres || litres <= 0)
      return NextResponse.json({ error: 'litres or open/close readings required' }, { status: 400 })

    // Snapshot the current active rate from the most recent purchase
    const [latestPurchase] = await db
      .select({ pricePerLitre: fuelPurchases.pricePerLitre })
      .from(fuelPurchases)
      .orderBy(desc(fuelPurchases.purchaseDate))
      .limit(1)

    const ratePerLitre = latestPurchase?.pricePerLitre ?? '28.36'

    const today = new Date().toISOString().split('T')[0]

    const [row] = await db.insert(fuelFills).values({
      fillDate:     fillDate ?? today,
      driverId:     driverId ?? null,
      driverName,
      vehicle,
      openReading:  openReading != null ? String(openReading) : null,
      closeReading: closeReading != null ? String(closeReading) : null,
      litres:       String(litres),
      isEstimated:  isEstimated ?? false,
      ratePerLitre: String(ratePerLitre),
      photoUrl:     photoUrl ?? null,
      notes:        notes ?? null,
      status:       'draft',
      flag:         isEstimated ? 'estimated' : 'ok',
      createdBy:    createdBy ?? null,
    }).returning()

    return NextResponse.json(row, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/fuel-fills POST]', err)
    return NextResponse.json({ error: 'Failed to save fill' }, { status: 500 })
  }
}
