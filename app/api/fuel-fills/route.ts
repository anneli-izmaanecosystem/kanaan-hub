import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, fuelFills, fuelAllocations, alpheusDays, fuelPurchases } from '@/lib/db'
import { desc, eq, and } from 'drizzle-orm'

// POST /api/fuel-fills — capture a new fill from the web (saves as draft, same as the mobile app)
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { fillDate, driverName, vehicle, openReading, closeReading, litres: rawLitres, isEstimated, notes } = body

    if (!driverName) return NextResponse.json({ error: 'Driver required' },  { status: 400 })
    if (!vehicle)    return NextResponse.json({ error: 'Vehicle required' }, { status: 400 })

    if (openReading != null && closeReading != null && parseFloat(closeReading) <= parseFloat(openReading))
      return NextResponse.json({ error: 'Close reading must be higher than the open reading' }, { status: 400 })

    let litres = rawLitres
    if (!litres && openReading != null && closeReading != null) {
      litres = parseFloat(closeReading) - parseFloat(openReading)
    }
    if (!litres || litres <= 0)
      return NextResponse.json({ error: 'Litres or open/close readings required' }, { status: 400 })

    // Snapshot the current active rate from the most recent purchase
    const [latestPurchase] = await db
      .select({ pricePerLitre: fuelPurchases.pricePerLitre })
      .from(fuelPurchases)
      .orderBy(desc(fuelPurchases.purchaseDate))
      .limit(1)

    const [row] = await db.insert(fuelFills).values({
      fillDate:     fillDate ?? new Date().toISOString().split('T')[0],
      driverName,
      vehicle,
      openReading:  openReading != null ? String(openReading) : null,
      closeReading: closeReading != null ? String(closeReading) : null,
      litres:       String(litres),
      isEstimated:  isEstimated ?? false,
      ratePerLitre: String(latestPurchase?.pricePerLitre ?? '28.36'),
      notes:        notes || null,
      status:       'draft',
      flag:         isEstimated ? 'estimated' : 'ok',
      createdBy:    userId,
    }).returning()

    return NextResponse.json({ ...row, allocations: [] }, { status: 201 })
  } catch (err: any) {
    console.error('[fuel-fills POST]', err)
    return NextResponse.json({ error: 'Failed to save fill' }, { status: 500 })
  }
}

// GET /api/fuel-fills — full list with allocations for recon view
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const fills = await db
    .select()
    .from(fuelFills)
    .orderBy(desc(fuelFills.fillDate), desc(fuelFills.createdAt))

  const allocations = await db.select().from(fuelAllocations)
  const days = await db.select({ id: alpheusDays.id, dayDate: alpheusDays.dayDate }).from(alpheusDays)

  // Attach allocations (with the Alpheus Day date they're matched to, if any) to each fill
  const result = fills.map(f => ({
    ...f,
    allocations: allocations.filter(a => a.fillId === f.id).map(a => ({
      ...a,
      dayDate: a.dayId != null ? days.find(d => d.id === a.dayId)?.dayDate ?? null : null,
    })),
  }))

  return NextResponse.json(result)
}
