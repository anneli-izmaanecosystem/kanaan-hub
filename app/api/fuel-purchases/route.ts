import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, fuelPurchases } from '@/lib/db'
import { desc } from 'drizzle-orm'

// GET /api/fuel-purchases — full history + active rate (most recent)
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db.select().from(fuelPurchases).orderBy(desc(fuelPurchases.purchaseDate))

  return NextResponse.json({
    purchases: rows,
    activeRate: rows[0]?.pricePerLitre ?? null,
    activeRateDate: rows[0]?.purchaseDate ?? null,
  })
}

// POST /api/fuel-purchases — record a bulk delivery; auto-calculates totals
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      purchaseDate, supplier, invoiceNo, docketNo,
      litres, pricePerLitre, vatRate: vatRateRaw, notes, createdBy,
    } = body

    if (!purchaseDate)   return NextResponse.json({ error: 'purchaseDate required' },   { status: 400 })
    if (!litres)         return NextResponse.json({ error: 'litres required' },         { status: 400 })
    if (!pricePerLitre)  return NextResponse.json({ error: 'pricePerLitre required' },  { status: 400 })

    const L        = parseFloat(litres)
    const rate     = parseFloat(pricePerLitre)
    const vatRate  = vatRateRaw != null ? parseFloat(vatRateRaw) : 0
    const exclVat  = L * rate
    const inclVat  = exclVat * (1 + vatRate / 100)

    const [row] = await db.insert(fuelPurchases).values({
      purchaseDate,
      supplier:      supplier ?? 'Bosbok Gas Nelspruit',
      invoiceNo:     invoiceNo ?? null,
      docketNo:      docketNo ?? null,
      litres:        String(L),
      pricePerLitre: String(rate),
      totalExclVat:  exclVat.toFixed(2),
      vatRate:       String(vatRate),
      totalInclVat:  inclVat.toFixed(2),
      notes:         notes ?? null,
      createdBy:     createdBy ?? null,
    }).returning()

    return NextResponse.json(row, { status: 201 })
  } catch (err: any) {
    console.error('[fuel-purchases POST]', err)
    return NextResponse.json({ error: 'Failed to save purchase' }, { status: 500 })
  }
}
