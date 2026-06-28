import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { fuelInvoices } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const invoices = await db
    .select()
    .from(fuelInvoices)
    .orderBy(desc(fuelInvoices.createdAt))

  return NextResponse.json(invoices)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const {
    clientName, billingInfo,
    periodStart, periodEnd,
    hours, tlbRate,
    dieselLitres, dieselRate,
    vatRate = 15,
    notes,
  } = body

  if (!clientName || !periodStart || !periodEnd || !hours || !tlbRate || !dieselLitres || !dieselRate) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const labourExclVat = parseFloat(hours) * parseFloat(tlbRate)
  const dieselCost    = parseFloat(dieselLitres) * parseFloat(dieselRate)
  const subtotal      = labourExclVat + dieselCost
  const vatAmount     = subtotal * (parseFloat(vatRate) / 100)
  const totalDue      = subtotal + vatAmount

  // Generate invoice number: INV-YYYY-NNNN
  const year = new Date().getFullYear()
  const existing = await db.select({ invoiceNumber: fuelInvoices.invoiceNumber }).from(fuelInvoices)
  const thisYearCount = existing.filter(r => r.invoiceNumber.startsWith(`INV-${year}`)).length
  const invoiceNumber = `INV-${year}-${String(thisYearCount + 1).padStart(4, '0')}`

  const [row] = await db.insert(fuelInvoices).values({
    invoiceNumber,
    clientName,
    billingInfo: billingInfo ?? null,
    periodStart,
    periodEnd,
    hours:         String(hours),
    tlbRate:       String(tlbRate),
    labourExclVat: String(labourExclVat.toFixed(2)),
    dieselLitres:  String(dieselLitres),
    dieselRate:    String(dieselRate),
    dieselCost:    String(dieselCost.toFixed(2)),
    vatRate:       String(vatRate),
    vatAmount:     String(vatAmount.toFixed(2)),
    totalDue:      String(totalDue.toFixed(2)),
    paymentStatus: 'unpaid',
    notes:         notes ?? null,
    createdBy:     userId,
  }).returning()

  return NextResponse.json(row, { status: 201 })
}
