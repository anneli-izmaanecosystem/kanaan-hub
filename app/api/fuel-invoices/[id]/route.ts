import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { fuelInvoices } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { paymentStatus, paidAt, paymentMethod, notes } = body

  const updates: Record<string, unknown> = {}
  if (paymentStatus) updates.paymentStatus = paymentStatus
  if (paidAt)        updates.paidAt        = new Date(paidAt)
  if (paymentMethod) updates.paymentMethod = paymentMethod
  if (notes !== undefined) updates.notes   = notes

  const [row] = await db
    .update(fuelInvoices)
    .set(updates)
    .where(eq(fuelInvoices.id, parseInt(id)))
    .returning()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}
