import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, entities } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  try {
    const body = await req.json()
    const n = (v: any) => (v != null && v !== '' ? String(v) : null)

    const [updated] = await db
      .update(entities)
      .set({
        name:           body.name,
        tradingName:    n(body.tradingName),
        registrationNo: n(body.registrationNo),
        uifRef:         n(body.uifRef),
        payeRef:        n(body.payeRef),
        address:        n(body.address),
        active:         body.active ?? true,
      })
      .where(eq(entities.id, parseInt(id)))
      .returning()

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[entities PATCH]', err)
    return NextResponse.json({ error: 'Failed to update entity' }, { status: 500 })
  }
}
